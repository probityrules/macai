import type { OllamaToolCall } from "../ollama/OllamaClient.js";

/**
 * Some local models (including qwen3-coder) emit tool calls as XML in message
 * content instead of Ollama's native tool_calls array. Parse those so the agent
 * can still execute tools.
 *
 * Supported shapes:
 *   <function=name>
 *   <parameter=key>
 *   value
 *   </parameter>
 *   </function>
 *
 *   <function=name>
 *   <parameter name="key">value</parameter>
 *   </function>
 */
export function parseEmbeddedToolCalls(content: string): OllamaToolCall[] {
  if (!content?.trim()) return [];

  const calls: OllamaToolCall[] = [];
  const functionRe = /<function=([a-zA-Z0-9_]+)>([\s\S]*?)<\/function>/g;

  for (const match of content.matchAll(functionRe)) {
    const name = match[1];
    const body = match[2] ?? "";
    const args: Record<string, unknown> = {};

    const paramRe = /<parameter=([a-zA-Z0-9_]+)>\s*([\s\S]*?)\s*<\/parameter>/g;
    for (const param of body.matchAll(paramRe)) {
      args[param[1]] = coerceArgValue(param[2].trim());
    }

    const namedParamRe = /<parameter\s+name=["']([a-zA-Z0-9_]+)["']>\s*([\s\S]*?)\s*<\/parameter>/g;
    for (const param of body.matchAll(namedParamRe)) {
      args[param[1]] = coerceArgValue(param[2].trim());
    }

    // Some models put a JSON object as the function body
    if (Object.keys(args).length === 0) {
      const jsonBody = body.trim();
      if (jsonBody.startsWith("{") && jsonBody.endsWith("}")) {
        try {
          Object.assign(args, JSON.parse(jsonBody) as Record<string, unknown>);
        } catch {
          // ignore
        }
      }
    }

    calls.push({ function: { name, arguments: args } });
  }

  return calls;
}

function coerceArgValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (
    (raw.startsWith("{") && raw.endsWith("}")) ||
    (raw.startsWith("[") && raw.endsWith("]"))
  ) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

/** Prefer native tool_calls; fall back to embedded XML in content. */
export function resolveToolCalls(
  message: { content?: string; tool_calls?: OllamaToolCall[] },
): OllamaToolCall[] {
  const native = message.tool_calls ?? [];
  if (native.length > 0) return native;
  return parseEmbeddedToolCalls(message.content ?? "");
}
