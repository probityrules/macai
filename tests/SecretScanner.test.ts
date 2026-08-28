import { describe, it, expect } from "vitest";
import { SecretScanner } from "../src/security/SecretScanner.js";

describe("SecretScanner", () => {
  const scanner = new SecretScanner();

  it("detects AWS keys in diff", () => {
    const diff = "+const key = 'AKIAIOSFODNN7EXAMPLE';";
    const findings = scanner.scanDiff(diff);
    expect(findings.some((f) => f.name === "AWS Access Key")).toBe(true);
    expect(scanner.hasHighConfidenceSecrets(diff)).toBe(true);
  });

  it("detects private keys", () => {
    const diff = "+-----BEGIN RSA PRIVATE KEY-----\n+MIIE...";
    expect(scanner.hasHighConfidenceSecrets(diff)).toBe(true);
  });

  it("ignores removed lines", () => {
    const diff = "-const key = 'AKIAIOSFODNN7EXAMPLE';";
    expect(scanner.hasHighConfidenceSecrets(diff)).toBe(false);
  });
});
