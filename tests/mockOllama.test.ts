import { describe, it, expect } from "vitest";
import { createMockOllama } from "./helpers/mockOllama.js";

describe("mockOllama helper", () => {
  it("returns canned chat responses in order", async () => {
    const ollama = createMockOllama({
      chatResponses: ["one", "two"],
    });
    expect((await ollama.chat([{ role: "user", content: "hi" }])).message.content).toBe("one");
    expect((await ollama.chat([{ role: "user", content: "hi" }])).message.content).toBe("two");
    expect((await ollama.chat([{ role: "user", content: "hi" }])).message.content).toBe("two");
    expect((await ollama.healthCheck()).ok).toBe(true);
  });
});
