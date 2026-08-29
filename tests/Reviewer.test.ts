import { describe, it, expect, vi } from "vitest";
import { Reviewer } from "../src/agent/Reviewer.js";
import type { OllamaClient } from "../src/ollama/OllamaClient.js";

describe("Reviewer", () => {
  it("rejects empty diffs without calling the model", async () => {
    const chat = vi.fn();
    const ollama = { chat } as unknown as OllamaClient;
    const reviewer = new Reviewer(ollama);

    const result = await reviewer.review("Enhance README", "   ");
    expect(result.approved).toBe(false);
    expect(result.feedback).toContain("REJECTED");
    expect(chat).not.toHaveBeenCalled();
  });

  it("uses model decision for non-empty diffs", async () => {
    const chat = vi.fn().mockResolvedValue({
      message: { content: "APPROVED\nLooks good." },
    });
    const ollama = { chat } as unknown as OllamaClient;
    const reviewer = new Reviewer(ollama);

    const result = await reviewer.review("Enhance README", " README.md | 10 +++++");
    expect(result.approved).toBe(true);
    expect(chat).toHaveBeenCalledOnce();
  });
});
