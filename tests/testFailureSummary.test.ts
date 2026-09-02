import { describe, it, expect } from "vitest";
import { summarizeTestFailureOutput } from "../src/helpers/testFailureSummary.js";

describe("summarizeTestFailureOutput", () => {
  it("skips CRLF noise and surfaces FAIL sections from the head slice", () => {
    const noise = Array.from({ length: 80 }, () =>
      "warning: LF will be replaced by CRLF in README.md.\nThe file will have its original line endings in your working directory",
    ).join("\n");
    const failBlock = [
      "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯",
      "FAIL  tests/RunLock.test.ts > RunLock > acquire",
      "TypeError: repo.cleanup is not a function",
      " ❯ tests/RunLock.test.ts:17:18",
    ].join("\n");
    const output = `${noise}\n${failBlock}\n`;

    const summary = summarizeTestFailureOutput(output, 4000);
    expect(summary).toContain("Failed Tests");
    expect(summary).toContain("repo.cleanup is not a function");
    expect(summary).not.toMatch(/LF will be replaced by CRLF/);
  });

  it("falls back to the tail when no FAIL marker exists", () => {
    const output = `${"x".repeat(5000)}TAIL_MARKER`;
    const summary = summarizeTestFailureOutput(output, 200);
    expect(summary).toContain("TAIL_MARKER");
    expect(summary).toContain("showing last");
  });
});
