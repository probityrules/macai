import type { AppConfig } from "../config/types.js";

export interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_name?: string;
}

export interface OllamaTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface ChatResponse {
  message: {
    role: string;
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

export interface ModelInfo {
  name: string;
  size?: number;
  parameter_size?: string;
  quantization_level?: string;
}

export class OllamaClient {
  private baseUrl: string;
  private model: string;
  private abortController: AbortController | null = null;

  constructor(config: AppConfig["ollama"]) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.model = config.model;
  }

  getModel(): string {
    return this.model;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async healthCheck(): Promise<{ ok: boolean; models: string[]; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) {
        return { ok: false, models: [], error: `HTTP ${res.status}` };
      }
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const models = (data.models ?? []).map((m) => m.name);
      const hasModel = models.some(
        (m) => m === this.model || m.startsWith(`${this.model.split(":")[0]}:`),
      );
      if (!hasModel) {
        return {
          ok: false,
          models,
          error: `Model '${this.model}' not found. Available: ${models.join(", ") || "none"}`,
        };
      }
      return { ok: true, models };
    } catch (err) {
      return {
        ok: false,
        models: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async getModelInfo(): Promise<ModelInfo | null> {
    try {
      const res = await fetch(`${this.baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: this.model }),
      });
      if (!res.ok) return null;
      return (await res.json()) as ModelInfo;
    } catch {
      return null;
    }
  }

  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async chat(
    messages: OllamaMessage[],
    tools?: OllamaTool[],
    options?: { temperature?: number; retries?: number; timeoutMs?: number },
  ): Promise<ChatResponse> {
    const maxAttempts = Math.max(1, (options?.retries ?? 5));
    const timeoutMs = options?.timeoutMs ?? 600_000;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.abortController = new AbortController();
      const timeout = setTimeout(() => this.abortController?.abort(), timeoutMs);

      const body: Record<string, unknown> = {
        model: this.model,
        messages,
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.2,
        },
      };

      if (tools && tools.length > 0) {
        body.tools = tools;
      }

      try {
        const res = await fetch(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: this.abortController.signal,
        });

        clearTimeout(timeout);
        this.abortController = null;

        if (!res.ok) {
          const text = await res.text();
          const err = new Error(`Ollama chat failed (${res.status}): ${text}`);
          if (!isTransientOllamaFailure(res.status, text) || attempt === maxAttempts) {
            throw err;
          }
          lastError = err;
          await sleep(750 * attempt);
          continue;
        }

        return (await res.json()) as ChatResponse;
      } catch (err) {
        clearTimeout(timeout);
        this.abortController = null;
        const error = err instanceof Error ? err : new Error(String(err));
        if (error.name === "AbortError") {
          throw new Error(`Ollama chat timed out after ${timeoutMs}ms`);
        }
        const msg = error.message;
        if (!isTransientOllamaFailure(0, msg) || attempt === maxAttempts) {
          throw error;
        }
        lastError = error;
        await sleep(750 * attempt);
      }
    }

    throw lastError ?? new Error("Ollama chat failed");
  }

  async *streamChat(
    messages: OllamaMessage[],
    tools?: OllamaTool[],
  ): AsyncGenerator<string, ChatResponse | undefined> {
    this.abortController = new AbortController();

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: this.abortController.signal,
    });

    if (!res.ok) {
      this.abortController = null;
      const text = await res.text();
      throw new Error(`Ollama stream failed (${res.status}): ${text}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      this.abortController = null;
      throw new Error("No response body from Ollama");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let finalResponse: ChatResponse | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const chunk = JSON.parse(line) as ChatResponse & { message?: { content?: string } };
          if (chunk.message?.content) {
            yield chunk.message.content;
          }
          if (chunk.done) {
            finalResponse = chunk;
          }
        }
      }
    } finally {
      this.abortController = null;
    }

    return finalResponse;
  }

  async generate(prompt: string): Promise<string> {
    this.abortController = new AbortController();

    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt, stream: false }),
      signal: this.abortController.signal,
    });

    this.abortController = null;

    if (!res.ok) {
      throw new Error(`Ollama generate failed (${res.status})`);
    }

    const data = (await res.json()) as { response: string };
    return data.response;
  }
}

function isTransientOllamaFailure(status: number, body: string): boolean {
  if (status === 500 || status === 502 || status === 503 || status === 504) return true;
  const lower = body.toLowerCase();
  return (
    lower.includes("eof") ||
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("fetch failed") ||
    lower.includes("socket hang up")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
