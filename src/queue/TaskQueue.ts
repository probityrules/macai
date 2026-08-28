import type { TaskDefinition, TaskMode } from "../config/types.js";
import type { MacaiDatabase, TaskRecord } from "../persistence/Database.js";

export class TaskQueue {
  constructor(
    private db: MacaiDatabase,
    private runId: string,
  ) {}

  enqueueAll(tasks: TaskDefinition[]): TaskRecord[] {
    const records: TaskRecord[] = [];

    tasks.forEach((task, index) => {
      const id = `task-${String(index + 1).padStart(3, "0")}`;
      const mode: TaskMode = task.mode ?? "coding";
      const priority = task.priority ?? 10 - index;

      this.db.createTask({
        id,
        runId: this.runId,
        title: task.title,
        description: task.description,
        mode,
        priority,
      });

      const record = this.db.getTask(id);
      if (record) records.push(record);
    });

    return records;
  }

  getNext(): TaskRecord | undefined {
    const queued = this.db.getQueuedTasks(this.runId);
    return queued[0];
  }

  getAll(): TaskRecord[] {
    return this.db.getTasksByRun(this.runId);
  }

  markComplete(taskId: string): void {
    this.db.updateTask(taskId, { status: "completed" });
  }

  markFailed(taskId: string, reason: string): void {
    this.db.updateTask(taskId, {
      status: "failed",
      failure_reason: reason,
    });
  }
}
