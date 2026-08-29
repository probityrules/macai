import type { OllamaClient } from "../ollama/OllamaClient.js";
import { getReviewPrompt, parseReviewDecision } from "./prompts/system.js";

export class Reviewer {
  constructor(private ollama: OllamaClient) {}

  async review(taskTitle: string, diffSummary: string): Promise<{ approved: boolean; feedback: string }> {
    const trimmed = diffSummary.trim();
    if (!trimmed) {
      return {
        approved: false,
        feedback:
          "REJECTED: Diff is empty. No files were changed. Use write_file or edit_file to implement the task, then review again.",
      };
    }

    const response = await this.ollama.chat([
      {
        role: "system",
        content:
          "You are a code review assistant. Be strict but fair. Never approve an empty diff. " +
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
