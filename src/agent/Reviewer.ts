import type { OllamaClient } from "../ollama/OllamaClient.js";
import { getReviewPrompt, parseReviewDecision } from "./prompts/system.js";

export class Reviewer {
  constructor(private ollama: OllamaClient) {}

  async review(taskTitle: string, diffSummary: string): Promise<{ approved: boolean; feedback: string }> {
    const response = await this.ollama.chat([
      {
        role: "system",
        content: "You are a code review assistant. Be strict but fair.",
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
