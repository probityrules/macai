import type { OllamaClient } from "../ollama/OllamaClient.js";
import { getReviewPrompt, parseReviewDecision } from "./prompts/system.js";

export class Reviewer {
  constructor(private ollama: OllamaClient) {}

  async review(taskTitle: string, diffSummary: string): Promise<{ approved: boolean; feedback: string }> {
    const trimmed = diffSummary.trim();
    const hasDeliverablePath =
      /\b(src|tests|templates|\.github)\//i.test(trimmed) ||
      /\b(README\.md|package\.json|vitest\.config|tsconfig)/i.test(trimmed);
    const emptyOrNoise =
      !trimmed ||
      (!hasDeliverablePath &&
        (/\(empty\)/i.test(trimmed) || /node_modules|\.vite\/vitest|results\.json/i.test(trimmed)));

    if (emptyOrNoise) {
      return {
        approved: false,
        feedback:
          "REJECTED: Diff has no meaningful source changes. Use write_file or edit_file to implement the task, then review again.",
      };
    }

    // Documentation-only deliverables (README / config examples) are enough to approve without an LLM round-trip.
    const docOnly =
      /\bREADME\.md\b/i.test(trimmed) &&
      !/\bsrc\//i.test(trimmed) &&
      !/\btests\//i.test(trimmed);
    if (docOnly) {
      return {
        approved: true,
        feedback: "APPROVED: Documentation changes look on-task.",
      };
    }

    const response = await this.ollama.chat([
      {
        role: "system",
        content:
          "You are a code review assistant. Be strict but fair. Never approve an empty or cache-only diff. " +
          "If the diff implements the task and looks safe, respond APPROVED. " +
          "Only REJECT when there is a concrete defect.",
      },
      {
        role: "user",
        content: `${getReviewPrompt(taskTitle)}\n\nDiff summary:\n${diffSummary}`,
      },
    ]);

    const feedback = response.message.content.trim();
    return {
      approved: parseReviewDecision(feedback),
      feedback,
    };
  }
}
