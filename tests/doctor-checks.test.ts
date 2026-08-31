import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkCoveragePackages } from "../src/helpers/doctor-checks.js";

describe("checkCoveragePackages", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "macai-doctor-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("skips check when no test:coverage script", () => {
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    expect(checkCoveragePackages(tmp)).toEqual({ ok: true, missing: [] });
  });

  it("reports missing coverage package", () => {
    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify({ scripts: { "test:coverage": "vitest run --coverage" } }),
    );
    fs.mkdirSync(path.join(tmp, "node_modules", "vitest"), { recursive: true });
    const result = checkCoveragePackages(tmp);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("@vitest/coverage-v8");
  });
});
