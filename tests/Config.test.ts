import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findConfigFile, loadConfig } from "../src/config/Config.js";

describe("Config", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "macai-config-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("findConfigFile discovers macai.config.yaml in a directory", () => {
    const configPath = path.join(tmp, "macai.config.yaml");
    fs.writeFileSync(
      configPath,
      "ollama:\n  baseUrl: http://10.0.0.29:11434\n  model: test-model:latest\n",
    );

    expect(findConfigFile(tmp)).toBe(configPath);
  });

  it("loadConfig uses repo config when no explicit path is given", () => {
    fs.writeFileSync(
      path.join(tmp, "macai.config.yaml"),
      "ollama:\n  baseUrl: http://10.0.0.29:11434\n  model: test-model:latest\n",
    );

    const config = loadConfig(undefined, tmp);
    expect(config.ollama.baseUrl).toBe("http://10.0.0.29:11434");
    expect(config.ollama.model).toBe("test-model:latest");
  });

  it("returns defaults when no config file exists", () => {
    const config = loadConfig(undefined, tmp);
    expect(config.ollama.baseUrl).toBe("http://127.0.0.1:11434");
  });
});
