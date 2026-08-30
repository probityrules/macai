import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

let cached: string | null = null;

/** Resolve a usable git executable, with Windows fallbacks when PATH is incomplete. */
export function resolveGitBinary(): string {
  if (cached) return cached;

  const fromEnv = process.env.GIT_EXEC_PATH || process.env.MACAI_GIT;
  if (fromEnv) {
    const candidate = fromEnv.endsWith("git") || fromEnv.endsWith("git.exe")
      ? fromEnv
      : path.join(fromEnv, process.platform === "win32" ? "git.exe" : "git");
    if (fs.existsSync(candidate)) {
      cached = candidate;
      return cached;
    }
  }

  try {
    execFileSync("git", ["--version"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    cached = "git";
    return cached;
  } catch {
    // fall through
  }

  if (process.platform === "win32") {
    const candidates = [
      path.join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Git", "cmd", "git.exe"),
      path.join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Git", "bin", "git.exe"),
      path.join(
        process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
        "Git",
        "cmd",
        "git.exe",
      ),
      path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Git", "cmd", "git.exe"),
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) {
        cached = c;
        return cached;
      }
    }
  }

  cached = "git";
  return cached;
}

export function gitExecFile(
  args: string[],
  options: { cwd?: string; encoding?: BufferEncoding } = {},
): string {
  return execFileSync(resolveGitBinary(), args, {
    cwd: options.cwd,
    encoding: options.encoding ?? "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  }).trim();
}
