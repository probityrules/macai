import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getMacaiDbPath, getMacaiDir } from "../config/Config.js";
import type { AppConfig } from "../config/types.js";
import { MacaiDatabase } from "../persistence/Database.js";
import { RepoDetector } from "../repo/RepoDetector.js";
import { WorktreeManager } from "../git/WorktreeManager.js";

const PATH_IN_PROMPT =
  /(?:^|[\s"'`(=])((?:\.?[\w.-]+[\\/])+[\w.-]+\.[\w]+|(?:\.macai|\.\/|\.\.\/)[^\s"'`)]+)/gi;

export function extractPathsFromPrompt(prompt: string): string[] {
  const found = new Set<string>();
  for (const match of prompt.matchAll(PATH_IN_PROMPT)) {
    const raw = match[1]?.replace(/[\\/]+$/, "").replace(/\\/g, "/") ?? "";
    if (raw.length > 2) found.add(raw);
  }
  return [...found];
}

function readHead(filePath: string, maxLines: number): string | undefined {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return undefined;
    const content = fs.readFileSync(filePath, "utf8");
    if (!content.trim()) return undefined;
    return content.split(/\r?\n/).slice(0, maxLines).join("\n");
  } catch {
    return undefined;
  }
}

function listDirNames(dir: string, max = 40): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.name !== ".git" && e.name !== "node_modules")
      .slice(0, max)
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  } catch {
    return [];
  }
}

function gitPorcelain(repoPath: string, maxLines = 20): string {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], {
      cwd: repoPath,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (!out) return "clean";
    const lines = out.split("\n");
    const shown = lines.slice(0, maxLines).join("\n");
    return lines.length > maxLines ? `${shown}\n… (${lines.length - maxLines} more)` : shown;
  } catch {
    return "unavailable";
  }
}

function investigationReports(macaiDir: string): Array<{ path: string; preview: string }> {
  const tasksDir = path.join(macaiDir, "tasks");
  if (!fs.existsSync(tasksDir)) return [];

  const reports: Array<{ path: string; preview: string }> = [];
  for (const entry of fs.readdirSync(tasksDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const reportPath = path.join(tasksDir, entry.name, "investigation-report.md");
    const preview = readHead(reportPath, 40);
    if (!preview) continue;
    reports.push({
      path: path.join(".macai", "tasks", entry.name, "investigation-report.md").replace(/\\/g, "/"),
      preview,
    });
  }
  return reports.slice(0, 8);
}

function recentDbTasks(repoPath: string, limit = 12): string[] {
  const dbPath = getMacaiDbPath(repoPath);
  if (!fs.existsSync(dbPath)) return [];

  try {
    const db = new MacaiDatabase(dbPath);
    const projectId = db.getOrCreateProject(repoPath);
    const rows = db.getRecentTasksForProject(projectId, limit);
    db.close();
    return rows.map(
      (t) => `- [${t.status}] (${t.mode}) ${t.title}${t.branch ? ` @ ${t.branch}` : ""}`,
    );
  } catch {
    return [];
  }
}

export function buildRepoAssessment(
  repoPath: string,
  config: AppConfig,
  prompt?: string,
): string {
  const root = path.resolve(repoPath);
  const detector = new RepoDetector();
  const detected = detector.detect(root, config.repo);
  const macaiDir = getMacaiDir(root);

  let branch = "unknown";
  try {
    branch = new WorktreeManager(root).getCurrentBranch();
  } catch {
    // not a git repo
  }

  const topLevel = listDirNames(root, 30).filter((n) => n !== ".macai/");
  const sections: string[] = [
    `Path: ${root}`,
    `Branch: ${branch}`,
    `Language: ${detected.language}`,
    `Test command: ${detected.commands.test ?? "unknown"}`,
    `Top-level entries: ${topLevel.join(", ") || "none"}`,
    `Git status:\n${gitPorcelain(root)}`,
  ];

  const readme = readHead(path.join(root, "README.md"), 60);
  if (readme) {
    sections.push(`README.md (excerpt):\n${readme}`);
  }

  const srcListing = listDirNames(path.join(root, "src"), 40);
  if (srcListing.length > 0) {
    sections.push(`src/ entries: ${srcListing.join(", ")}`);
  }

  const reports = investigationReports(macaiDir);
  if (reports.length > 0) {
    sections.push(
      "Existing investigation reports (reuse these; do not re-investigate unless stale):",
    );
    for (const r of reports) {
      sections.push(`### ${r.path}\n${r.preview}`);
    }
  }

  const macaiReport = readHead(path.join(macaiDir, "macai-report.md"), 40);
  if (macaiReport) {
    sections.push(`Latest macai-report.md (excerpt):\n${macaiReport}`);
  }

  const recent = recentDbTasks(root);
  if (recent.length > 0) {
    sections.push(`Recent macai tasks:\n${recent.join("\n")}`);
  }

  if (prompt) {
    const hinted = extractPathsFromPrompt(prompt);
    const fileBlocks: string[] = [];
    for (const hint of hinted.slice(0, 6)) {
      const resolved = path.isAbsolute(hint) ? hint : path.resolve(root, hint);
      const head = readHead(resolved, 80);
      if (head) {
        const rel = path.relative(root, resolved).replace(/\\/g, "/") || hint;
        fileBlocks.push(`### Prompt-referenced file: ${rel}\n${head}`);
      }
    }
    if (fileBlocks.length > 0) {
      sections.push(`Files referenced in the developer prompt:\n${fileBlocks.join("\n\n")}`);
    }
  }

  return sections.join("\n\n");
}
