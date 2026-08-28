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

    for (let i = 0; i < 3; i++) {
      expect(guard.canRetry(cmd, "exploratory")).toBe(true);
      guard.trackRetry(cmd, "exploratory");
    }
    expect(guard.canRetry(cmd, "exploratory")).toBe(false);

    // validation budget is independent
    expect(guard.canRetry(cmd, "validation")).toBe(true);
    for (let i = 0; i < 20; i++) {
      guard.trackRetry(cmd, "validation");
    }
    expect(guard.canRetry(cmd, "validation")).toBe(false);
  });
});
