import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppConfigSchema } from "../src/config/types.js";
import { ShellGuard } from "../src/security/ShellGuard.js";
import { createFileTools } from "../src/tools/FileTools.js";
import type { ToolContext } from "../src/tools/types.js";

describe("FileTools", () => {
  let tmpDir: string;
  let config: ReturnType<typeof AppConfigSchema.parse>;
  let ctx: ToolContext;
  let tools: Map<string, { execute: (args: Record<string, unknown>) => Promise<string> }>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macai-filetools-"));
    config = AppConfigSchema.parse({});
    ctx = {
      worktreePath: tmpDir,
      taskId: "testtask",
      readOnly: false,
      logDir: path.join(tmpDir, "logs"),
    };
    const shellGuard = new ShellGuard(config);
    tools = new Map(
      createFileTools(config, ctx, shellGuard).map((tool) => [tool.name, tool]),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("read_file returns content for existing file", async () => {
    fs.writeFileSync(path.join(tmpDir, "hello.txt"), "hello world");
    const result = JSON.parse(await tools.get("read_file")!.execute({ path: "hello.txt" }));
    expect(result.content).toBe("hello world");
  });

  it("read_file returns error for missing file", async () => {
    const result = JSON.parse(await tools.get("read_file")!.execute({ path: "missing.txt" }));
    expect(result.error).toMatch(/not found/i);
  });

  it("write_file creates file with content", async () => {
    const result = JSON.parse(
      await tools.get("write_file")!.execute({ path: "out.txt", content: "data" }),
    );
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, "out.txt"), "utf8")).toBe("data");
  });

  it("write_file rejects missing content", async () => {
    const result = JSON.parse(await tools.get("write_file")!.execute({ path: "out.txt" }));
    expect(result.error).toMatch(/requires string content/i);
  });

  it("blocks write_file and edit_file in read-only mode", async () => {
    ctx.readOnly = true;
    const shellGuard = new ShellGuard(config);
    const readOnlyTools = new Map(
      createFileTools(config, ctx, shellGuard).map((tool) => [tool.name, tool]),
    );
    fs.writeFileSync(path.join(tmpDir, "edit-me.txt"), "before");

    const writeResult = JSON.parse(
      await readOnlyTools.get("write_file")!.execute({ path: "x.txt", content: "y" }),
    );
    expect(writeResult.error).toMatch(/read-only/i);

    const editResult = JSON.parse(
      await readOnlyTools.get("edit_file")!.execute({
        path: "edit-me.txt",
        old_text: "before",
        new_text: "after",
      }),
    );
    expect(editResult.error).toMatch(/read-only/i);
  });

  it("blocks path traversal via ShellGuard", async () => {
    const result = JSON.parse(
      await tools.get("read_file")!.execute({ path: "../outside.txt" }),
    );
    expect(result.error).toMatch(/traversal|escapes/i);
  });
});
