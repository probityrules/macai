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

```bash
# Check environment
macai doctor --repo ./my-project

# Option A: explicit task file
macai start --repo ./my-project --tasks tasks.yaml --hours 8

# Option B: natural-language prompt (generates tasks.yaml, then runs)
macai prompt --repo ./my-project "Add parser tests, review TODOs in src/, and improve API error handling."

# Preview generated plan without running
macai prompt --repo ./my-project --dry-run "Add tests for the transcript parser"

# Morning review
macai status --repo ./my-project
macai report --repo ./my-project
```

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

Branches are created as `macai/task-001`, etc. Your primary working tree is never modified.

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
