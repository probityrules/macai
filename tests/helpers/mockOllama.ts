import type { ChatResponse, OllamaClient, OllamaMessage, OllamaTool } from "../../src/ollama/OllamaClient.js";

/**
 * Lightweight OllamaClient stub for unit tests.
 * Prefer this over mocking the class with an arrow factory
 * (which causes "is not a constructor").
 *
 * DO NOT rewrite this file to use jest.fn — this project uses vitest.
 * Import createMockOllama and pass chatResponses instead.
 */
export interface MockOllamaOptions {
  model?: string;
  baseUrl?: string;
  /** Responses returned in order from chat(); last response repeats if exhausted. */
  chatResponses?: Array<string | ChatResponse>;
  healthOk?: boolean;
}

function asChatResponse(content: string | ChatResponse): ChatResponse {
  if (typeof content === "string") {
    return {
      message: { role: "assistant", content },
      done: true,
    };
  }
  return content;
}

export function createMockOllama(options: MockOllamaOptions = {}): OllamaClient {
  let chatIndex = 0;
  const responses = options.chatResponses ?? [
    "Understood the repository.",
    "1. Inspect files\n2. Summarize findings",
    "Investigation complete. Key modules remain untested.",
  ];

  const client = {
    getModel: () => options.model ?? "mock-model",
    getBaseUrl: () => options.baseUrl ?? "http://127.0.0.1:11434",
    cancel: () => undefined,
    healthCheck: async () =>
      options.healthOk === false
        ? { ok: false as const, models: [], error: "mock unhealthy" }
        : { ok: true as const, models: [options.model ?? "mock-model"] },
    getModelInfo: async () => null,
    chat: async (_messages: OllamaMessage[], _tools?: OllamaTool[]) => {
      const idx = Math.min(chatIndex, responses.length - 1);
      chatIndex += 1;
      return asChatResponse(responses[idx]!);
    },
    generate: async (prompt: string) => `mock:${prompt.slice(0, 40)}`,
    streamChat: async function* () {
      yield "mock";
      return asChatResponse(responses[responses.length - 1]!);
    },
  };

  return client as unknown as OllamaClient;
}
