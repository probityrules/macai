import type { AgentPhase, CheckpointState, TaskMode } from "../config/types.js";
import type { OllamaMessage } from "../ollama/OllamaClient.js";
import type { MacaiDatabase } from "../persistence/Database.js";

export class ContextManager {
  private state: CheckpointState;
  private priorHandoff?: string;

  constructor(
    private taskId: string,
    private db: MacaiDatabase,
    initial?: Partial<CheckpointState>,
  ) {
    this.state = {
      phase: "understand",
      filesExamined: [],
      filesChanged: [],
      decisions: [],
      iteration: 0,
      ...initial,
    };
  }

  getState(): CheckpointState {
    return { ...this.state };
  }

  setPriorHandoff(summary: string): void {
    this.priorHandoff = summary;
  }

  getPriorHandoff(): string | undefined {
    return this.priorHandoff;
  }

  setPhase(phase: AgentPhase): void {
    this.state.phase = phase;
    this.saveCheckpoint(`Phase: ${phase}`);
  }

  setPlan(plan: string): void {
    this.state.plan = plan;
    this.saveCheckpoint("Plan created");
  }

  addFileExamined(path: string): void {
    if (!this.state.filesExamined.includes(path)) {
      this.state.filesExamined.push(path);
    }
  }

  addFileChanged(path: string): void {
    if (!this.state.filesChanged.includes(path)) {
      this.state.filesChanged.push(path);
    }
  }

  addDecision(decision: string): void {
    this.state.decisions.push(decision);
  }

  incrementIteration(): number {
    this.state.iteration += 1;
    return this.state.iteration;
  }

  getIteration(): number {
    return this.state.iteration;
  }

  buildCompactContext(task: {
    title: string;
    description: string;
    mode: TaskMode;
  }): string {
    return [
      `# Task: ${task.title}`,
      `Mode: ${task.mode}`,
      `Description: ${task.description}`,
      this.priorHandoff ? `\n## Prior task handoff\n${this.priorHandoff}` : "",
      this.state.plan ? `\n## Plan\n${this.state.plan}` : "",
      this.state.filesExamined.length
        ? `\n## Files Examined\n${this.state.filesExamined.slice(-20).join("\n")}`
        : "",
      this.state.filesChanged.length
        ? `\n## Files Changed\n${this.state.filesChanged.join("\n")}`
        : "",
      this.state.decisions.length
        ? `\n## Decisions\n${this.state.decisions.slice(-10).join("\n")}`
        : "",
      `\n## Current Phase: ${this.state.phase}`,
      `Iteration: ${this.state.iteration}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  shouldCompact(messageCount: number, threshold = 40): boolean {
    return messageCount >= threshold;
  }

  compactMessages(
    messages: OllamaMessage[],
    task: { title: string; description: string; mode: TaskMode },
  ): OllamaMessage[] {
    const system = messages.find((m) => m.role === "system");
    const compact = this.buildCompactContext(task);
    return [
      ...(system ? [system] : []),
      { role: "user", content: `[Context compacted]\n\n${compact}\n\nContinue from current phase.` },
    ];
  }

  saveCheckpoint(label: string): void {
    this.db.saveCheckpoint(this.taskId, label, this.state);
  }

  static loadFromCheckpoint(
    taskId: string,
    db: MacaiDatabase,
  ): ContextManager | undefined {
    const checkpoint = db.getLatestCheckpoint(taskId);
    if (!checkpoint) return undefined;
    return new ContextManager(taskId, db, checkpoint.state);
  }
}
