import { createHash } from "node:crypto";

export function generateTaskId(runId: string, index: number, title: string): string {
  return createHash("sha256")
    .update(`${runId}\0${index}\0${title}`)
    .digest("hex")
    .slice(0, 16);
}
