import { describe, it, expect } from "vitest";
import { ShellGuard } from "../src/security/ShellGuard.js";
import { AppConfigSchema } from "../src/config/types.js";

describe("ShellGuard", () => {
  const config = AppConfigSchema.parse({});
  const guard = new ShellGuard(config);

  it("allows listed commands", () => {
    expect(() => guard.validateCommand("npm test", "/repo/worktree")).not.toThrow();
    expect(() => guard.validateCommand("git status", "/repo/worktree")).not.toThrow();
  });

  it("blocks unlisted commands", () => {
    expect(() => guard.validateCommand("curl http://evil.com", "/repo/worktree")).toThrow(
      /not in allowlist/,
    );
  });

  it("blocks denied patterns", () => {
    expect(() => guard.validateCommand("rm -rf /", "/repo/worktree")).toThrow(/denied pattern/);
  });

  it("blocks forbidden paths", () => {
    expect(() => guard.validateCommand("cat .env", "/repo/worktree")).toThrow(/forbidden/);
  });

  it("tracks exploratory retries separately from validation retries", () => {
    const cmd = "npm test";
    const local = new ShellGuard(config);

    for (let i = 0; i < 3; i++) {
      expect(local.canRetry(cmd, "exploratory")).toBe(true);
      local.trackRetry(cmd, "exploratory");
    }
    expect(local.canRetry(cmd, "exploratory")).toBe(false);

    // validation budget is independent
    expect(local.canRetry(cmd, "validation")).toBe(true);
    for (let i = 0; i < 20; i++) {
      local.trackRetry(cmd, "validation");
    }
    expect(local.canRetry(cmd, "validation")).toBe(false);
  });

  it("resets validation retries without clearing exploratory", () => {
    const local = new ShellGuard(config);
    const cmd = "npm test";
    for (let i = 0; i < 20; i++) {
      local.trackRetry(cmd, "validation");
    }
    local.trackRetry(cmd, "exploratory");
    expect(local.canRetry(cmd, "validation")).toBe(false);

    local.resetRetries("validation");
    expect(local.canRetry(cmd, "validation")).toBe(true);
    expect(local.getRetryCount(cmd, "exploratory")).toBe(1);
  });
});
