import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createTempGitRepo, removeTempGitRepo, openTempDatabase, seedMinimalRun } from './helpers/tempMacaiRepo.ts';
import { ReportGenerator } from '../src/reporting/ReportGenerator.ts';

let tempRepo: ReturnType<typeof createTempGitRepo> | null = null;

describe('ReportGenerator', () => {
  afterEach(() => {
    if (tempRepo) {
      removeTempGitRepo(tempRepo);
      tempRepo = null;
    }
  });

  it('generates a run report with correct run ID', () => {
    tempRepo = createTempGitRepo();
    const db = openTempDatabase(tempRepo.repoPath);
    seedMinimalRun(db, tempRepo.repoPath);

    const reportGenerator = new ReportGenerator(db, tempRepo.repoPath);
    const reportPath = reportGenerator.generateRunReport('testrun01');
    
    expect(reportPath).toBeTypeOf('string');
    
    const reportContent = fs.readFileSync(reportPath, 'utf8');
    expect(reportContent).toContain('Run ID: testrun01');
    expect(reportContent).toContain('# macai Run Report');
  });

  it('includes "## Cleanup Suggestions" when stale worktree directory exists', () => {
    tempRepo = createTempGitRepo();
    const db = openTempDatabase(tempRepo.repoPath);
    seedMinimalRun(db, tempRepo.repoPath);

    // Create a stale worktree directory to trigger cleanup suggestion
    const macaiDir = path.join(tempRepo.repoPath, '.macai');
    const taskDir = path.join(macaiDir, 'tasks', 'taskabcd12345678');
    const worktreeDir = path.join(taskDir, 'worktree');
    fs.mkdirSync(worktreeDir, { recursive: true });
    
    // Create a fake .git file to make it look like a valid git directory
    fs.writeFileSync(path.join(worktreeDir, '.git'), 'gitdir: ../.git\n');

    const reportGenerator = new ReportGenerator(db, tempRepo.repoPath);
    const reportPath = reportGenerator.generateRunReport('testrun01');
    
    const reportContent = fs.readFileSync(reportPath, 'utf8');
    
    // Should contain the run ID
    expect(reportContent).toContain('Run ID: testrun01');
    
    // Should include "## Cleanup Suggestions" section (not "Cleanup Summary")
    expect(reportContent).toContain('## Cleanup Suggestions');
    expect(reportContent).not.toContain('## Cleanup Summary');
  });
});