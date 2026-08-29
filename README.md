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

# Keep going after a failed task (default is stop-on-failure)
macai prompt --continue-on-failure "..."

# Morning review
macai status
macai report
```

If a run is already active on the repo, additional `macai start` or `macai prompt` invocations are **queued** and run sequentially when the current run finishes. Different repos can run concurrently without interfering with each other.

### Prompt planning

`macai prompt` builds a **repository assessment** before calling the planner: README excerpt, `src/` listing, git status, existing `.macai` investigation reports, recent task history, and any file paths named in your prompt. The planner prefers reusing that evidence (fewer tasks, start at the first missing deliverable) instead of redundant investigation.

### Task execution

- Task IDs are content hashes.
- **Coding / testing / documentation / refactoring** get an isolated worktree under `.macai/tasks/<hash>/worktree/` and branch `macai/<hash>`. Successful mutating tasks **chain**: the next worktree is based on the prior task’s branch so later tasks see earlier commits (e.g. a `TODO.md` from a documentation task).
- **Investigation / review** run read-only in the repo (no branch) and write `.macai/tasks/<hash>/investigation-report.md`.
- **Documentation** mode skips the full test suite; it reviews and commits doc changes only.
- By default the run **stops after the first failed task** and cancels remaining queued tasks. Pass `--continue-on-failure` to keep going.
- Live console output includes phase transitions, iteration numbers, and tool calls.

Generated prompt plans are saved under `.macai/generated/<timestamp>/` as `tasks.yaml`, `run-plan.json`, and `prompt.txt`.

## Output

All run artifacts live in `<repo>/.macai/`:

```
.macai/
├── database.sqlite
├── macai-report.md
└── tasks/
    └── <task-hash>/
        ├── worktree/          # coding tasks only
        ├── investigation-report.md  # investigation/review tasks
        ├── run.log
        └── report.md
```

Coding tasks create branches as `macai/<task-hash>`. Your primary working tree is never modified by coding tasks. Read-only tasks do not create branches.

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
