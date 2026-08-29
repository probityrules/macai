import type { AgentPhase, TaskStatus } from "../config/types.js";

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  queued: ["starting", "cancelled"],
  starting: ["planning", "working", "failed", "cancelled"],
  planning: ["working", "failed", "cancelled"],
  working: ["testing", "working", "failed", "cancelled", "timed_out", "blocked"],
  testing: ["working", "reviewing", "failed", "cancelled"],
  reviewing: ["working", "completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  blocked: [],
  cancelled: [],
  timed_out: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid task transition: ${from} -> ${to}`);
  }
}

export function isTerminalStatus(status: TaskStatus): boolean {
  return ["completed", "failed", "blocked", "cancelled", "timed_out"].includes(status);
}

export function isReadOnlyMode(mode: string): boolean {
  return mode === "review" || mode === "investigation";
}

export function usesWorktree(mode: string): boolean {
  return !isReadOnlyMode(mode);
}

export function shouldRunValidation(mode: string): boolean {
  return mode !== "documentation" && mode !== "review" && mode !== "investigation";
}

export function statusForPhase(phase: AgentPhase): TaskStatus {
  switch (phase) {
    case "understand":
      return "starting";
    case "plan":
      return "planning";
    case "work":
      return "working";
    case "test":
      return "testing";
    case "review":
      return "reviewing";
    case "commit":
      return "reviewing";
    default:
      return "working";
  }
}

export const PHASE_ORDER: AgentPhase[] = ["understand", "plan", "work", "test", "review", "commit"];

export function nextPhase(current: AgentPhase): AgentPhase | null {
  const idx = PHASE_ORDER.indexOf(current);
  if (idx === -1 || idx === PHASE_ORDER.length - 1) return null;
  return PHASE_ORDER[idx + 1];
}
