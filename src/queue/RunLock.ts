import fs from "node:fs";
import path from "node:path";
import { getMacaiDir } from "../config/Config.js";

export interface RunLockData {
  pid: number;
  runId: string;
  startedAt: string;
}

export class RunLock {
  private lockPath: string;

  constructor(repoPath: string) {
    this.lockPath = path.join(getMacaiDir(repoPath), "macai.lock");
  }

  tryAcquire(runId: string): boolean {
    this.releaseIfStale();
    fs.mkdirSync(path.dirname(this.lockPath), { recursive: true });

    const payload: RunLockData = {
      pid: process.pid,
      runId,
      startedAt: new Date().toISOString(),
    };

    try {
      const fd = fs.openSync(this.lockPath, "wx");
      fs.writeFileSync(fd, JSON.stringify(payload), "utf8");
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        return false;
      }
      throw err;
    }
  }

  release(): void {
    try {
      if (!fs.existsSync(this.lockPath)) return;
      const current = this.read();
      if (current?.pid === process.pid) {
        fs.unlinkSync(this.lockPath);
      }
    } catch {
      // ignore
    }
  }

  read(): RunLockData | null {
    try {
      return JSON.parse(fs.readFileSync(this.lockPath, "utf8")) as RunLockData;
    } catch {
      return null;
    }
  }

  releaseIfStale(): void {
    if (!fs.existsSync(this.lockPath)) return;

    const holder = this.read();
    if (!holder || !isProcessAlive(holder.pid)) {
      try {
        fs.unlinkSync(this.lockPath);
      } catch {
        // ignore
      }
    }
  }

  getActiveRunId(): string | null {
    this.releaseIfStale();
    return this.read()?.runId ?? null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
