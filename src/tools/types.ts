export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export interface ToolContext {
  worktreePath: string;
  taskId: string;
  readOnly: boolean;
  logDir: string;
}

export interface ToolResult {
  success: boolean;
  output: string;
  outputPath?: string;
}

export function toOllamaTool(tool: ToolDefinition): {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
} {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
