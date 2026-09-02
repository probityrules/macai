import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  createTempGitRepo,
  openTempDatabase,
  removeTempGitRepo,
  seedMinimalRun,
  type TempGitRepo,
} from "./helpers/tempMacaiRepo.js";

describe("tempMacaiRepo helpers", () => {
  let repo: TempGitRepo | undefined;

  afterEach(() => {
    if (repo) {
      removeTempGitRepo(repo);
      repo = undefined;
    }
  });

  it("creates a git repo and seeds a runnable sqlite database", () => {
    repo = createTempGitRepo();
    expect(typeof repo.cleanup).toBe("function");
    const db = openTempDatabase(repo.repoPath);
    try {
      const seeded = seedMinimalRun(db, repo.repoPath);
      const run = db.getRun(seeded.runId);
      expect(run?.id).toBe(seeded.runId);
      expect(fs.existsSync(path.join(repo!.repoPath, ".macai", "database.sqlite"))).toBe(true);
    } finally {
      db.close();
    }
  });
});
