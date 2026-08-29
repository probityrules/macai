import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseTestOutput,
  nodeModulesHealthy,
  ensureWorktreeDependencies,
} from "../src/repo/RepoDetector.js";

describe("RepoDetector", () => {
  it("parses jest output", () => {
    const output = "Tests: 2 failed, 418 passed, 420 total";
    const counts = parseTestOutput(output);
    expect(counts.passed).toBe(418);
    expect(counts.failed).toBe(2);
  });

  it("parses mocha output", () => {
    const output = "  45 passing (2s)\n  3 failing";
    const counts = parseTestOutput(output);
    expect(counts.passed).toBe(45);
    expect(counts.failed).toBe(3);
  });

  it("detects healthy vitest node_modules", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "macai-nm-"));
    try {
      expect(nodeModulesHealthy(tmp)).toBe(false);
      const cli = path.join(tmp, "node_modules", "vitest", "dist", "cli.js");
      fs.mkdirSync(path.dirname(cli), { recursive: true });
      fs.writeFileSync(cli, "export {}\n");
      expect(nodeModulesHealthy(tmp)).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("links matching main node_modules into a worktree", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "macai-link-"));
    const main = path.join(tmp, "main");
    const wt = path.join(tmp, "worktree");
    try {
      fs.mkdirSync(main);
      fs.mkdirSync(wt);
      const pkg = JSON.stringify({ name: "t", version: "1.0.0" });
      const lock = JSON.stringify({ lockfileVersion: 3 });
      fs.writeFileSync(path.join(main, "package.json"), pkg);
      fs.writeFileSync(path.join(wt, "package.json"), pkg);
      fs.writeFileSync(path.join(main, "package-lock.json"), lock);
      fs.writeFileSync(path.join(wt, "package-lock.json"), lock);

      const cli = path.join(main, "node_modules", "vitest", "dist", "cli.js");
      fs.mkdirSync(path.dirname(cli), { recursive: true });
      fs.writeFileSync(cli, "export {}\n");

      await ensureWorktreeDependencies(wt, undefined, 30_000, undefined, main);
      expect(nodeModulesHealthy(wt)).toBe(true);
      expect(fs.existsSync(path.join(wt, "node_modules", "vitest", "dist", "cli.js"))).toBe(
        true,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
