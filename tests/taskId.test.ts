import { describe, it, expect } from "vitest";
import { generateTaskId } from "../src/queue/taskId.js";

describe("generateTaskId", () => {
  it("returns stable 16-char hex ids per run/index/title", () => {
    const a = generateTaskId("abc123", 0, "Add tests");
    const b = generateTaskId("abc123", 0, "Add tests");
    const c = generateTaskId("abc123", 1, "Add tests");
    const d = generateTaskId("def456", 0, "Add tests");

    expect(a).toBe(b);
    expect(a).toHaveLength(16);
    expect(c).not.toBe(a);
    expect(d).not.toBe(a);
  });
});
