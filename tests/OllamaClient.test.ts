import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OllamaClient } from "../src/ollama/OllamaClient.js";

describe("OllamaClient", () => {
  const config = { baseUrl: "http://127.0.0.1:11434", model: "qwen3-coder:latest" };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("healthCheck succeeds when model is available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ models: [{ name: "qwen3-coder:latest" }] }),
      })),
    );

    const client = new OllamaClient(config);
    const health = await client.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.models).toContain("qwen3-coder:latest");
  });

  it("healthCheck fails when model is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ models: [{ name: "llama3:latest" }] }),
      })),
    );

    const client = new OllamaClient(config);
    const health = await client.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.error).toMatch(/not found/i);
  });

  it("healthCheck fails on unreachable URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Failed to fetch");
      }),
    );

    const client = new OllamaClient(config);
    const health = await client.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.error).toBeDefined();
  });

  it("chat with successful JSON response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          message: { role: "assistant", content: "Hello there!" },
          done: true,
        }),
      })),
    );

    const client = new OllamaClient(config);
    const response = await client.chat([{ role: "user", content: "hi" }]);
    
    expect(response.message.content).toBe("Hello there!");
    expect(response.done).toBe(true);
  });

  it("chat retries on transient 500 EOF then succeeds", async () => {
    let chatCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        if (String(url).endsWith("/api/chat")) {
          chatCalls++;
          if (chatCalls === 1) {
            return {
              ok: false,
              status: 500,
              text: async () => '{"error":"EOF"}',
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              message: { role: "assistant", content: "done" },
              done: true,
            }),
          };
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const client = new OllamaClient(config);
    const promise = client.chat([{ role: "user", content: "hi" }], undefined, { retries: 3 });
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(chatCalls).toBe(2);
    expect(response.message.content).toBe("done");
  });

  it("chat throws immediately on non-transient HTTP 400", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => "bad request",
      })),
    );

    const client = new OllamaClient(config);
    await expect(
      client.chat([{ role: "user", content: "hi" }], undefined, { retries: 3 }),
    ).rejects.toThrow(/400/);
  });
});