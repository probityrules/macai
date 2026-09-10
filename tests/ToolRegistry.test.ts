import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ToolRegistry } from "../src/tools/ToolRegistry.js";
import { createTestAppConfig } from "./helpers/tempMacaiRepo.js";

describe("ToolRegistry", () => {
  let tmpDir: string;
  let config: ReturnType<typeof createTestAppConfig>;
  let ctx: Parameters<typeof ToolRegistry>[1];
  let registry: ToolRegistry;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers core tools", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macai-toolreg-"));
    config = createTestAppConfig();
    ctx = {
      worktreePath: tmpDir,
      taskId: "toolreg01",
      readOnly: false,
      logDir: path.join(tmpDir, "logs")
    };
    fs.mkdirSync(ctx.logDir, { recursive: true });

    registry = new ToolRegistry(config, ctx);

    const names = registry.getTools().map(t => t.name);
    expect(names).toContain("read_file");
    expect(names).toContain("run_tests");
  });

  it("formats Ollama tools correctly", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macai-toolreg-"));
    config = createTestAppConfig();
    ctx = {
      worktreePath: tmpDir,
      taskId: "toolreg02",
      readOnly: false,
      logDir: path.join(tmpDir, "logs")
    };
    fs.mkdirSync(ctx.logDir, { recursive: true });

    registry = new ToolRegistry(config, ctx);

    const ollamaTools = registry.getOllamaTools();
    expect(ollamaTools).toHaveLength(registry.getTools().length);
    ollamaTools.forEach(tool => {
      expect(tool.type).toBe("function");
      expect(typeof tool.function.name).toBe("string");
    });
  });

  it("handles unknown tools", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macai-toolreg-"));
    config = createTestAppConfig();
    ctx = {
      worktreePath: tmpDir,
      taskId: "toolreg03",
      readOnly: false,
      logDir: path.join(tmpDir, "logs")
    };
    fs.mkdirSync(ctx.logDir, { recursive: true });

    registry = new ToolRegistry(config, ctx);

    const result = await registry.execute("not_a_real_tool", {});
    const json = JSON.parse(result);
    expect(json.error).toMatch(/^Unknown tool: not_a_real_tool/);
  });

  it("executes run_tests with node command", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macai-toolreg-"));
    config = createTestAppConfig({ repo: { test: 'node -e "process.exit(0)"' } });
    ctx = {
      worktreePath: tmpDir,
      taskId: "toolreg04",
      readOnly: false,
      logDir: path.join(tmpDir, "logs")
    };
    fs.mkdirSync(ctx.logDir, { recursive: true });

    registry = new ToolRegistry(config, ctx);

    const result = await registry.execute("run_tests", {});
    const json = JSON.parse(result);
    expect(json.exitCode).toBe(0);
  });
});