const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp; confidence: "high" | "medium" }> = [
  { name: "AWS Access Key", pattern: /AKIA[0-9A-Z]{16}/, confidence: "high" },
  { name: "Private Key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, confidence: "high" },
  { name: "Generic API Key", pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[a-zA-Z0-9_\-]{20,}/i, confidence: "high" },
  { name: "Bearer Token", pattern: /bearer\s+[a-zA-Z0-9_\-.]{20,}/i, confidence: "medium" },
  { name: "Password Assignment", pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"\n]{8,}['"]/i, confidence: "medium" },
  { name: "GitHub Token", pattern: /ghp_[a-zA-Z0-9]{20,}/, confidence: "high" },
  { name: "Slack Token", pattern: /xox[baprs]-[a-zA-Z0-9-]{10,}/, confidence: "high" },
];

export interface SecretFinding {
  name: string;
  confidence: "high" | "medium";
  line?: number;
  snippet: string;
}

export class SecretScanner {
  scanDiff(diff: string): SecretFinding[] {
    const findings: SecretFinding[] = [];
    const lines = diff.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith("+") || line.startsWith("+++")) continue;

      const content = line.slice(1);
      for (const { name, pattern, confidence } of SECRET_PATTERNS) {
        if (pattern.test(content)) {
          findings.push({
            name,
            confidence,
            line: i + 1,
            snippet: content.slice(0, 80),
          });
        }
      }
    }

    return findings;
  }

  hasHighConfidenceSecrets(diff: string): boolean {
    return this.scanDiff(diff).some((f) => f.confidence === "high");
  }
}
