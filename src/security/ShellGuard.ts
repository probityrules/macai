import type { AppConfig, ShellCommandKind } from "../config/types.js";

export class ShellGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShellGuardError";
  }
}

export class ShellGuard {
  private allowedCommands: Set<string>;
  private deniedPatterns: RegExp[];
  private forbiddenPaths: string[];
  private retryCounts = new Map<string, number>();

  constructor(private config: AppConfig) {
    this.allowedCommands = new Set(config.shell.allowedCommands.map((c) => c.toLowerCase()));
    this.deniedPatterns = config.shell.deniedPatterns.map((p) => new RegExp(p, "i"));
    this.forbiddenPaths = config.paths.forbidden;
  }

  validateCommand(command: string, cwd: string): void {
    const trimmed = command.trim();
    if (!trimmed) {
      throw new ShellGuardError("Empty command");
    }

    for (const pattern of this.deniedPatterns) {
      if (pattern.test(trimmed)) {
        throw new ShellGuardError(`Command matches denied pattern: ${pattern.source}`);
      }
    }

    for (const forbidden of this.forbiddenPaths) {
      if (trimmed.includes(forbidden)) {
        throw new ShellGuardError(`Command references forbidden path: ${forbidden}`);
      }
    }

    const firstToken = this.extractFirstToken(trimmed).toLowerCase();
    const baseName = firstToken.split(/[/\\]/).pop() ?? firstToken;

    if (!this.allowedCommands.has(baseName)) {
      throw new ShellGuardError(
        `Command '${baseName}' not in allowlist: ${[...this.allowedCommands].join(", ")}`,
      );
    }

    if (cwd.includes("..")) {
      throw new ShellGuardError("Invalid working directory");
    }
  }

  validatePath(filePath: string, worktreeRoot: string): void {
    const normalized = filePath.replace(/\\/g, "/");
    for (const forbidden of this.forbiddenPaths) {
      if (normalized.includes(forbidden)) {
        throw new ShellGuardError(`Path references forbidden location: ${forbidden}`);
      }
    }

    if (normalized.startsWith("..") || normalized.includes("/../")) {
      throw new ShellGuardError("Path traversal not allowed");
    }

    void worktreeRoot;
  }

  private retryKey(commandSignature: string, kind: ShellCommandKind): string {
    return `${kind}:${commandSignature}`;
  }

  private maxRetriesFor(kind: ShellCommandKind): number {
    return kind === "validation"
      ? this.config.limits.maxRetriesPerValidationCommand
      : this.config.limits.maxRetriesPerCommand;
  }

  trackRetry(commandSignature: string, kind: ShellCommandKind = "exploratory"): number {
    const key = this.retryKey(commandSignature, kind);
    const count = (this.retryCounts.get(key) ?? 0) + 1;
    this.retryCounts.set(key, count);
    return count;
  }

  getRetryCount(commandSignature: string, kind: ShellCommandKind = "exploratory"): number {
    return this.retryCounts.get(this.retryKey(commandSignature, kind)) ?? 0;
  }

  canRetry(commandSignature: string, kind: ShellCommandKind = "exploratory"): boolean {
    return this.getRetryCount(commandSignature, kind) < this.maxRetriesFor(kind);
  }

  hasExceededRetries(commandSignature: string, kind: ShellCommandKind): boolean {
    const count = this.trackRetry(commandSignature, kind);
    return count > this.maxRetriesFor(kind);
  }

  resetRetries(kind?: ShellCommandKind): void {
    if (!kind) {
      this.retryCounts.clear();
      return;
    }
    const prefix = `${kind}:`;
    for (const key of [...this.retryCounts.keys()]) {
      if (key.startsWith(prefix)) {
        this.retryCounts.delete(key);
      }
    }
  }

  private extractFirstToken(command: string): string {
    const match = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/);
    if (!match) return command;
    let token = match[0];
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      token = token.slice(1, -1);
    }
    return token;
  }
}

export function truncateOutput(output: string, maxBytes: number): { text: string; truncated: boolean } {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(output);
  if (bytes.length <= maxBytes) {
    return { text: output, truncated: false };
  }

  const truncated = new TextDecoder().decode(bytes.slice(0, maxBytes));
  return {
    text: `${truncated}\n\n[... output truncated at ${maxBytes} bytes ...]`,
    truncated: true,
  };
}
