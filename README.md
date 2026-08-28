# macai

Local autonomous coding agent using Ollama, Git worktrees, and a task queue.

## Prerequisites

- Node.js 20+
- Git 2.5+
- Ollama server (default: `http://10.0.0.29:11434`)
- Model: `qwen3-coder:latest`

## Install

```bash
npm install
npm run build
npm link   # optional: install `macai` CLI globally
```

## Quick Start

From inside your project directory ( `--repo` defaults to the current folder):

```bash
# Check environment
macai doctor

# Option A: explicit task file
macai start --tasks tasks.yaml --hours 8

# Option B: natural-language prompt (generates tasks.yaml, then runs)
macai prompt "Add parser tests, review TODOs in src/, and improve API error handling."

# Preview generated plan without running
macai prompt --dry-run "Add tests for the transcript parser"

# Morning review
macai status
macai report
```

If a run is already active on the repo, additional `macai start` or `macai prompt` invocations are **queued** and run sequentially when the current run finishes. Different repos can run concurrently without interfering with each other.

Task IDs are content hashes, so each task gets a unique worktree under `.macai/tasks/<hash>/` and branch `macai/<hash>`.

Generated prompt plans are saved under `.macai/generated/<timestamp>/` as `tasks.yaml`, `run-plan.json`, and `prompt.txt`.

## Output

All run artifacts live in `<repo>/.macai/`:

```
.macai/
├── database.sqlite
├── macai-report.md
└── tasks/
    └── task-001/
        ├── worktree/
        ├── run.log
        └── report.md
```

Branches are created as `macai/<task-hash>`, etc. Your primary working tree is never modified.

## Configuration

Copy `macai.config.example.yaml` and customize limits, shell allowlists, and repo commands.

## CLI Commands

| Command | Description |
|---------|-------------|
| `macai start` | Begin run from tasks.yaml |
| `macai prompt` | Plan from natural language, then run |
| `macai status` | Show run status |
| `macai tasks list` | List tasks |
| `macai report` | Generate report |
| `macai doctor` | Health check |
| `macai cancel` | Cancel instructions |

## Development

```bash
npm run dev -- doctor
npm test
```
