import { describe, it, expect } from "vitest";
import {
  extractJsonFromResponse,
  parseGeneratedRunPlan,
} from "../src/planning/runPlanSchema.js";

describe("runPlanSchema", () => {
  it("extracts JSON from fenced code block", () => {
    const raw = 'Here is the plan:\n```json\n{"tasks":[{"title":"A","description":"Do A"}]}\n```';
    expect(extractJsonFromResponse(raw)).toBe('{"tasks":[{"title":"A","description":"Do A"}]}');
  });

  it("parses a valid generated run plan", () => {
    const plan = parseGeneratedRunPlan(
      JSON.stringify({
        summary: "Add tests",
        hours: 4,
        tasks: [
          {
            title: "Add parser tests",
            description: "Add tests for parser module",
            mode: "coding",
            priority: 10,
          },
        ],
      }),
    );

    expect(plan.summary).toBe("Add tests");
    expect(plan.hours).toBe(4);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].mode).toBe("coding");
  });

  it("rejects empty task lists", () => {
    expect(() => parseGeneratedRunPlan(JSON.stringify({ tasks: [] }))).toThrow();
  });
});
