import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppConfigSchema } from "../src/config/types.js";
import {
  buildRepoAssessment,
  extractPathsFromPrompt,
} from "../src/planning/RepoAssessment.js";

describe("RepoAssessment", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "macai-assess-"));
    fs.writeFileSync(path.join(tmpDir, "package.json"), '{"name":"t"}\n');
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# Sample\n\nHello world.\n");
    fs.mkdirSync(path.join(tmpDir, "src"));
    fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "export {};\n");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts paths from prompts", () => {
    const paths = extractPathsFromPrompt(
      'Check out .macai\\tasks\\abc123\\investigation-report.md and src/index.ts',
    );
    expect(paths.some((p) => p.includes("investigation-report.md"))).toBe(true);
    expect(paths.some((p) => p.includes("index.ts"))).toBe(true);
  });

  it("includes README and src listing", () => {
    const config = AppConfigSchema.parse({});
    const text = buildRepoAssessment(tmpDir, config);
    expect(text).toContain("README.md");
    expect(text).toContain("Hello world");
    expect(text).toContain("src/ entries:");
    expect(text).toContain("index.ts");
  });

  it("inventories non-empty investigation reports", () => {
    const reportDir = path.join(tmpDir, ".macai", "tasks", "deadbeef01234567");
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(
      path.join(reportDir, "investigation-report.md"),
      "# Investigation Report: Findings\n\n## Summary\nSomething broke.\n",
    );

    const config = AppConfigSchema.parse({});
    const text = buildRepoAssessment(tmpDir, config);
    expect(text).toContain("Existing investigation reports");
    expect(text).toContain(".macai/tasks/deadbeef01234567/investigation-report.md");
    expect(text).toContain("Something broke");
  });

  it("reads prompt-referenced files into assessment", () => {
    const reportDir = path.join(tmpDir, ".macai", "tasks", "feedfacefeedface");
    fs.mkdirSync(reportDir, { recursive: true });
    const rel = path.join(".macai", "tasks", "feedfacefeedface", "investigation-report.md");
    fs.writeFileSync(path.join(tmpDir, rel), "# Named report\nUnique marker XYZ.\n");

    const config = AppConfigSchema.parse({});
    const text = buildRepoAssessment(
      tmpDir,
      config,
      `Use ${rel.replace(/\\/g, "/")} as the source of todos.`,
    );
    expect(text).toContain("Prompt-referenced file");
    expect(text).toContain("Unique marker XYZ");
  });
});
