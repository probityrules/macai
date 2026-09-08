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

  it("write_file overwrites existing file", async () => {
    fs.writeFileSync(path.join(tmpDir, "overwrite.txt"), "initial");
    await tools.get("write_file")!.execute({ path: "overwrite.txt", content: "updated" });
    expect(fs.readFileSync(path.join(tmpDir, "overwrite.txt"), "utf8")).toBe("updated");
  });

  it("edit_file requires unique match", async () => {
    fs.writeFileSync(path.join(tmpDir, "duplicate.txt"), "before\nbefore");
    const result = JSON.parse(
      await tools.get("edit_file")!.execute({ path: "duplicate.txt", old_text: "before", new_text: "after" })
    );
    expect(result.error).toMatch(/unique/i);
  });

  it("list_directory returns entries and errors", async () => {
    const dirPath = path.join(tmpDir, "subdir");
    fs.mkdirSync(dirPath);
    fs.writeFileSync(path.join(dirPath, "file1.txt"), "");

    // Test valid directory listing
    const result = JSON.parse(
      await tools.get("list_directory")!.execute({ path: dirPath })
    );
    expect(result.entries).toBeDefined();
    expect(Array.isArray(result.entries)).toBe(true);

    // Test missing directory error
    const errorResult = JSON.parse(
      await tools.get("list_directory")!.execute({ path: "nonexistent" })
    );
    expect(errorResult.error).toMatch(/not found/i);
  });

  it("blocks path traversal in list_directory", async () => {
    const result = JSON.parse(
      await tools.get("list_directory")!.execute({ path: "../outside" })
    );
    expect(result.error).toMatch(/traversal/i);
  });
});