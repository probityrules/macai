import fs from "node:fs";
import path from "node:path";
import { ensureMacaiDir, getMacaiDir } from "../config/Config.js";

export interface AdoptState {
  taskId: string;
  branch: string;
  worktreePath: string | null;
  preAdoptHead: string;
  preAdoptBranch: string;
  adoptedAt: string;
  /** True when `git merge` stopped with conflicts still unresolved. */
  mergeInProgress: boolean;
}

export function getAdoptStatePath(repoPath: string): string {
  return path.join(getMacaiDir(repoPath), "adopted.json");
}

export function readAdoptState(repoPath: string): AdoptState | null {
  const statePath = getAdoptStatePath(repoPath);
  if (!fs.existsSync(statePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, "utf8")) as AdoptState;
    if (!raw?.taskId || !raw?.branch || !raw?.preAdoptHead || !raw?.preAdoptBranch) {
      return null;
    }
    return {
      taskId: raw.taskId,
      branch: raw.branch,
      worktreePath: raw.worktreePath ?? null,
      preAdoptHead: raw.preAdoptHead,
      preAdoptBranch: raw.preAdoptBranch,
      adoptedAt: raw.adoptedAt ?? "",
      mergeInProgress: Boolean(raw.mergeInProgress),
    };
  } catch {
    return null;
  }
}

export function writeAdoptState(repoPath: string, state: AdoptState): void {
  ensureMacaiDir(repoPath);
  fs.writeFileSync(getAdoptStatePath(repoPath), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function clearAdoptState(repoPath: string): void {
  const statePath = getAdoptStatePath(repoPath);
  if (fs.existsSync(statePath)) {
    fs.unlinkSync(statePath);
  }
}

export function assertNoAdoptState(repoPath: string, action: string): void {
  const existing = readAdoptState(repoPath);
  if (existing) {
    throw new Error(
      `Cannot ${action}: task ${existing.taskId} is adopted (branch ${existing.branch}). ` +
        `Run \`macai return\` or \`macai adopt --abort\` first.`,
    );
  }
}
