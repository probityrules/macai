import type { TaskMode } from "../../config/types.js";

export function getSystemPrompt(mode: TaskMode, phase: string): string {
  const readOnly = mode === "investigation" || mode === "review";
  const base = readOnly
    ? `You are macai, an autonomous coding agent working on a software task.
You operate directly in the repository in read-only mode. Do not create branches or modify files.

Core rules:
- Inspect the repository before drawing conclusions
- Prefer verified progress over confident guesses
- Distinguish observations from recommendations
- It is acceptable to fail with evidence rather than ship unverified conclusions

You have read/search tools available. Use them to inspect the codebase.
When done with a phase, respond with a brief summary of what you accomplished.`
    : `You are macai, an autonomous coding agent working on a software task.
You operate in isolated git worktrees. Never modify files outside the worktree.

Core rules:
- Inspect the repository before making changes
- Prefer verified progress over confident guesses
- Run tests after making changes
- Distinguish baseline test failures from new failures you introduced
- Review your diff before committing
- Do not leave debug statements, secrets, or weakened tests
- It is acceptable to fail with evidence rather than ship unverified code
- Optimize for small, validated changes

You have tools available. Use them to inspect, edit, test, and commit.
When done with a phase, respond with a brief summary of what you accomplished.`;

  const modeRules: Record<TaskMode, string> = {
    coding: "You may modify code and commit when tests pass.",
    testing: "Focus on adding tests. Modify code only if necessary for testability. If npm test is already green and no prior-task failures need fixing, finish without inventing new files. Never rewrite tests/helpers/* or unrelated modules.",
    review: "READ-ONLY mode. Do not modify files or commit. Produce findings and recommendations.",
    documentation:
      "Focus on documentation improvements. Keep code changes minimal. Do not run the full test suite; finish with a review and commit of doc changes. Prefer small README edits over rewriting the whole file.",
    refactoring: "Refactor safely with tests passing throughout.",
    investigation:
      "READ-ONLY mode. Investigate and produce a report. Do not modify production code.",
  };

  const phaseRules: Record<string, string> = {
    understand:
      "Phase: UNDERSTAND. Explore the repo structure, tests, conventions. Use read/search tools only.",
    plan: "Phase: PLAN. Create a numbered execution plan before editing.",
    work:
      mode === "documentation"
        ? "Phase: WORK. You MUST call write_file or edit_file to create or update documentation before finishing this phase. Do not end with only reads/searches. Do not run run_tests."
        : "Phase: WORK. Implement changes using tools. You MUST call write_file or edit_file (and related tools) — do not finish with text only. Call run_tests after significant edits. When adding Vitest tests: put them under tests/*.test.ts; follow patterns in existing tests/; use helpers from tests/helpers/tempMacaiRepo.ts for temp git repos and real MacaiDatabase instances — NEVER mock MacaiDatabase with an arrow factory (causes 'is not a constructor'); for OllamaClient stubs use tests/helpers/mockOllama.ts createMockOllama(); prefer temp dirs and lightweight stubs; if mocking a class use a real constructor (class or function).",
    investigate:
      "Phase: INVESTIGATE. Use read/search tools to gather evidence. Do not modify files. Take notes on findings.",
    report:
      "Phase: REPORT. Synthesize findings into a clear markdown report with summary, evidence, and recommendations.",
    test: "Phase: TEST. Run tests and analyze failures. Fix issues or document pre-existing failures.",
    review: "Phase: REVIEW. Run git_diff and git_status. Verify changes relate to the task.",
    commit: "Phase: COMMIT. Create a commit with message format: macai: <title>",
  };

  return [base, `\nTask mode: ${mode}\n${modeRules[mode]}`, phaseRules[phase] ?? ""].join("\n");
}

export function getPlanPrompt(taskDescription: string): string {
  return `Create an explicit numbered execution plan for this task:

${taskDescription}

List concrete steps. Be specific about files and tests to run.`;
}

export function getReviewPrompt(taskTitle: string): string {
  return `Review the changes for task "${taskTitle}".

Use git_diff and git_status. Verify:
- Changes relate to the task
- No accidental files modified
- No debug statements left
- No credentials added
- Tests were not weakened merely to pass
- No unrelated formatting changes

If the diff is empty or there are no file changes, you MUST respond REJECTED and tell the agent to implement the task with write_file/edit_file.

Respond with APPROVED or REJECTED followed by reasoning.`;
}

export function parseReviewDecision(response: string): boolean {
  const upper = response.toUpperCase();
  if (upper.includes("REJECTED")) return false;
  if (upper.includes("APPROVED")) return true;
  return !upper.includes("ISSUE") && !upper.includes("PROBLEM");
}

export function shouldSkipPlanning(description: string): boolean {
  return description.length < 120 && !description.includes("\n");
}

export function getInvestigationReportPrompt(data: {
  title: string;
  description: string;
  mode: TaskMode;
  plan?: string;
  filesExamined: string[];
  decisions: string[];
  evidence: string;
  workSummary?: string;
}): string {
  return `Write a markdown investigation report for this task.

Title: ${data.title}
Mode: ${data.mode}

Task description:
${data.description}

${data.plan ? `Plan:\n${data.plan}\n` : ""}
${data.filesExamined.length ? `Files examined:\n${data.filesExamined.join("\n")}\n` : ""}
${data.decisions.length ? `Notes:\n${data.decisions.join("\n")}\n` : ""}
${data.workSummary ? `Work phase summary:\n${data.workSummary}\n` : ""}

Tool evidence gathered:
${data.evidence}

Use this structure:
# Investigation Report: ${data.title}

## Summary
## Key Findings
## Evidence
## Recommendations
## Suggested Follow-up

Be specific. Reference files and observations from the evidence.`;
}
