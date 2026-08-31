import fs from "node:fs";
import path from "node:path";

export function checkCoveragePackages(repoRoot: string): { ok: boolean; missing: string[] } {
  const pkgPath = path.join(repoRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return { ok: true, missing: [] };

  let scripts: Record<string, string> = {};
  try {
    scripts = (JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> })
      .scripts ?? {};
  } catch {
    return { ok: true, missing: [] };
  }

  if (!scripts["test:coverage"]) return { ok: true, missing: [] };

  const required = ["vitest", "@vitest/coverage-v8"];
  const missing = required.filter(
    (name) => !fs.existsSync(path.join(repoRoot, "node_modules", name)),
  );
  return { ok: missing.length === 0, missing };
}
