import { describe, it, expect } from "vitest";
import { canTransition, isReadOnlyMode, usesWorktree, shouldRunValidation, assertTransition } from "../src/agent/AgentState.js";

describe("AgentState", () => {
  it("allows valid transitions", () => {
    expect(canTransition("queued", "starting")).toBe(true);
    expect(canTransition("working", "testing")).toBe(true);
    expect(canTransition("testing", "working")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    expect(canTransition("completed", "working")).toBe(false);
    expect(canTransition("queued", "completed")).toBe(false);
  });

  it("assertTransition throws on invalid", () => {
    expect(() => assertTransition("completed", "working")).toThrow();
  });

  it("identifies read-only modes", () => {
    expect(isReadOnlyMode("investigation")).toBe(true);
    expect(isReadOnlyMode("review")).toBe(true);
    expect(isReadOnlyMode("coding")).toBe(false);
  });

  it("skips worktrees for read-only modes", () => {
    expect(usesWorktree("investigation")).toBe(false);
    expect(usesWorktree("review")).toBe(false);
    expect(usesWorktree("coding")).toBe(true);
  });

  it("skips validation for documentation and read-only modes", () => {
    expect(shouldRunValidation("documentation")).toBe(false);
    expect(shouldRunValidation("investigation")).toBe(false);
    expect(shouldRunValidation("review")).toBe(false);
    expect(shouldRunValidation("coding")).toBe(true);
    expect(shouldRunValidation("testing")).toBe(true);
  });
});
