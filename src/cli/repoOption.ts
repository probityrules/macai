import path from "node:path";

export function resolveRepo(repo?: string): string {
  return path.resolve(repo?.trim() || process.cwd());
}
