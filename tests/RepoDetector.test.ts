import { describe, it, expect } from "vitest";
import { parseTestOutput } from "../src/repo/RepoDetector.js";

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
});
