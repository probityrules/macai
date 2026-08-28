import { describe, it, expect, vi } from "vitest";
import { InvestigationReporter } from "../src/agent/InvestigationReporter.js";
import type { OllamaClient } from "../src/ollama/OllamaClient.js";
import type { TaskRecord } from "../src/persistence/Database.js";

describe("InvestigationReporter", () => {
  const task: TaskRecord = {
    id: "abc123",
    run_id: "run1",
    title: "Review CLI entrypoint",
    description: "Investigate how the CLI is structured.",
    mode: "investigation",
    status: "working",
    priority: 0,
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    ended_at: null,
    error: null,
    branch: "macai/abc123",
    worktree_path: "/tmp/worktree",
  };

  it("uses fallback report when model returns empty content", async () => {
    const ollama = {
      chat: vi.fn().mockResolvedValue({ message: { content: "" } }),
    } as unknown as OllamaClient;

    const reporter = new InvestigationReporter(ollama);
    const report = await reporter.generate({
      task,
      state: {
        phase: "work",
        plan: "1. Read src/index.ts\n2. Summarize commands",
        filesExamined: ["src/index.ts", "README.md"],
        filesChanged: [],
        decisions: ["CLI uses commander"],
        iteration: 1,
      },
      toolCalls: [
        {
          tool_name: "read_file",
          result_preview: "import { Command } from 'commander'",
        },
      ],
    });

    expect(report).toContain("# Investigation Report: Review CLI entrypoint");
    expect(report).toContain("src/index.ts");
    expect(report).toContain("read_file");
    expect(report).toContain("1. Read src/index.ts");
  });

  it("returns model output when present", async () => {
    const ollama = {
      chat: vi.fn().mockResolvedValue({
        message: { content: "# Investigation Report\n\n## Summary\nAll good." },
      }),
    } as unknown as OllamaClient;

    const reporter = new InvestigationReporter(ollama);
    const report = await reporter.generate({
      task,
      state: {
        phase: "work",
        filesExamined: [],
        filesChanged: [],
        decisions: [],
        iteration: 0,
      },
      toolCalls: [],
    });

    expect(report).toBe("# Investigation Report\n\n## Summary\nAll good.");
  });
});
