export class Scheduler {
  private startTime = Date.now();
  private cancelled = false;
  private stopUntilMs: number | null = null;
  private maxRuntimeMs: number | null = null;

  constructor(options?: { hours?: number; until?: string }) {
    if (options?.hours) {
      this.maxRuntimeMs = options.hours * 60 * 60 * 1000;
    }
    if (options?.until) {
      this.stopUntilMs = this.parseUntilTime(options.until);
    }

    process.on("SIGINT", () => this.cancel());
    process.on("SIGTERM", () => this.cancel());
  }

  private parseUntilTime(until: string): number {
    const [hours, minutes] = until.split(":").map(Number);
    const now = new Date();
    const target = new Date(now);
    target.setHours(hours, minutes ?? 0, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }

  cancel(): void {
    this.cancelled = true;
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  shouldStop(): boolean {
    if (this.cancelled) return true;

    const elapsed = Date.now() - this.startTime;
    if (this.maxRuntimeMs !== null && elapsed >= this.maxRuntimeMs) {
      return true;
    }

    if (this.stopUntilMs !== null && Date.now() >= this.stopUntilMs) {
      return true;
    }

    return false;
  }

  getRuntimeMs(): number {
    return Date.now() - this.startTime;
  }

  getRemainingMs(): number | null {
    if (this.maxRuntimeMs === null) return null;
    return Math.max(0, this.maxRuntimeMs - this.getRuntimeMs());
  }
}
