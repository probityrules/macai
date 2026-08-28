import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/types.js";
import type { ShellGuard } from "../security/ShellGuard.js";
import type { ToolContext, ToolDefinition } from "./types.js";
import { resolveWorktreePath } from "./ToolRegistry.js";

const MAX_FILE_BYTES = 100_000;

export function createFileTools(
  config: AppConfig,
  ctx: ToolContext,
  shellGuard: ShellGuard,
): ToolDefinition[] {
  const readOnly = ctx.readOnly;

  return [
    {
      name: "read_file",
      description: "Read contents of a file relative to the worktree root.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
        },
        required: ["path"],
      },
      execute: async (args) => {
        const filePath = String(args.path);
        shellGuard.validatePath(filePath, ctx.worktreePath);
        const resolved = resolveWorktreePath(ctx.worktreePath, filePath);
        if (!fs.existsSync(resolved)) {
          return JSON.stringify({ error: `File not found: ${filePath}` });
        }
        const stat = fs.statSync(resolved);
        if (stat.size > MAX_FILE_BYTES) {
          const content = fs.readFileSync(resolved, "utf8").slice(0, MAX_FILE_BYTES);
          return JSON.stringify({
            path: filePath,
            content,
            truncated: true,
            size: stat.size,
          });
        }
        return JSON.stringify({
          path: filePath,
          content: fs.readFileSync(resolved, "utf8"),
        });
      },
    },
    {
      name: "write_file",
      description: "Write content to a file. Creates parent directories if needed.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
      execute: async (args) => {
        if (readOnly) return JSON.stringify({ error: "Write operations disabled in read-only mode" });
        const filePath = String(args.path);
        shellGuard.validatePath(filePath, ctx.worktreePath);
        const resolved = resolveWorktreePath(ctx.worktreePath, filePath);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, String(args.content), "utf8");
        return JSON.stringify({ success: true, path: filePath });
      },
    },
    {
      name: "edit_file",
      description: "Replace exact text in a file. old_text must appear exactly once.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_text: { type: "string" },
          new_text: { type: "string" },
        },
        required: ["path", "old_text", "new_text"],
      },
      execute: async (args) => {
        if (readOnly) return JSON.stringify({ error: "Write operations disabled in read-only mode" });
        const filePath = String(args.path);
        const oldText = String(args.old_text);
        const newText = String(args.new_text);
        shellGuard.validatePath(filePath, ctx.worktreePath);
        const resolved = resolveWorktreePath(ctx.worktreePath, filePath);
        if (!fs.existsSync(resolved)) {
          return JSON.stringify({ error: `File not found: ${filePath}` });
        }
        const content = fs.readFileSync(resolved, "utf8");
        const occurrences = content.split(oldText).length - 1;
        if (occurrences === 0) {
          return JSON.stringify({ error: "old_text not found in file" });
        }
        if (occurrences > 1) {
          return JSON.stringify({ error: `old_text found ${occurrences} times; must be unique` });
        }
        fs.writeFileSync(resolved, content.replace(oldText, newText), "utf8");
        return JSON.stringify({ success: true, path: filePath });
      },
    },
    {
      name: "list_directory",
      description: "List files and directories at a path.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative directory path (default: .)" },
          max_entries: { type: "number", description: "Max entries to return (default 100)" },
        },
      },
      execute: async (args) => {
        const dirPath = String(args.path ?? ".");
        const maxEntries = Number(args.max_entries ?? 100);
        shellGuard.validatePath(dirPath, ctx.worktreePath);
        const resolved = resolveWorktreePath(ctx.worktreePath, dirPath);
        if (!fs.existsSync(resolved)) {
          return JSON.stringify({ error: `Directory not found: ${dirPath}` });
        }
        const entries = fs.readdirSync(resolved, { withFileTypes: true }).slice(0, maxEntries);
        return JSON.stringify({
          path: dirPath,
          entries: entries.map((e) => ({
            name: e.name,
            type: e.isDirectory() ? "directory" : "file",
          })),
        });
      },
    },
    {
      name: "search_files",
      description: "Search for a pattern in files under a directory.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Text or regex pattern to search" },
          path: { type: "string", description: "Directory to search (default: .)" },
          glob: { type: "string", description: "File glob filter e.g. *.ts" },
        },
        required: ["pattern"],
      },
      execute: async (args) => {
        const pattern = String(args.pattern);
        const searchPath = String(args.path ?? ".");
        const glob = args.glob ? String(args.glob) : undefined;
        shellGuard.validatePath(searchPath, ctx.worktreePath);
        const resolved = resolveWorktreePath(ctx.worktreePath, searchPath);
        const results = searchInDir(resolved, ctx.worktreePath, pattern, glob, 50);
        return JSON.stringify({ matches: results, count: results.length });
      },
    },
  ];
}

function searchInDir(
  dir: string,
  worktreeRoot: string,
  pattern: string,
  glob: string | undefined,
  maxResults: number,
): Array<{ file: string; line: number; text: string }> {
  const results: Array<{ file: string; line: number; text: string }> = [];
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch {
    regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }

  function walk(current: string): void {
    if (results.length >= maxResults) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= maxResults) return;
      if (entry.name === "node_modules" || entry.name === ".git") continue;

      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        if (glob && !matchGlob(entry.name, glob)) continue;
        try {
          const content = fs.readFileSync(full, "utf8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push({
                file: path.relative(worktreeRoot, full).replace(/\\/g, "/"),
                line: i + 1,
                text: lines[i].trim().slice(0, 200),
              });
              if (results.length >= maxResults) return;
            }
          }
        } catch {
          // skip binary/unreadable
        }
      }
    }
  }

  walk(dir);
  return results;
}

function matchGlob(filename: string, glob: string): boolean {
  const regex = new RegExp(
    "^" + glob.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
    "i",
  );
  return regex.test(filename);
}
