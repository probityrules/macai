import type { OllamaClient } from "../ollama/OllamaClient.js";
import { getPlanPrompt } from "./prompts/system.js";

export class Planner {
  constructor(private ollama: OllamaClient) {}

  async createPlan(taskDescription: string, repoSummary: string): Promise<string> {
    const response = await this.ollama.chat([
      {
        role: "system",
        content: "You are a software planning assistant. Create concise, actionable plans.",
      },
      {
        role: "user",
        content: `${getPlanPrompt(taskDescription)}\n\nRepository context:\n${repoSummary}`,
      },
    ]);

    return response.message.content.trim();
  }
}
