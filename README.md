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

### Prompt planning

`macai prompt` builds a **repository assessment** before calling the planner: README excerpt, `src/` listing, git status, existing `.macai` investigation reports, recent task history, and any file paths named in your prompt. The planner prefers reusing that evidence (fewer tasks, start at the first missing deliverable) instead of redundant investigation.

### Task execution

- Task IDs are content hashes.
- **Coding / testing / documentation / refactoring** get an isolated worktree under `.macai/tasks/<hash>/worktree/` and branch `macai/<hash>`. Successful mutating tasks **chain**: the next worktree is based on the prior task's branch so later tasks see earlier commits (e.g. a `TODO.md` from a documentation task).
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

## CLI Commands

### Core Commands

| Command | Description |
|---------|-------------|
| `macai start` | Begin run from tasks.yaml |
| `macai prompt` | Plan from natural language, then run |
| `macai status` | Show run status |
| `macai tasks list` | List tasks |
| `macai report` | Generate report |
| `macai doctor` | Health check |
| `macai cleanup` | Remove stale worktrees and prune old task dirs |
| `macai review <task-id>` | Inspect a task (status, branch, report preview) |
| `macai cancel` | Cancel instructions |

### Command Options

#### `macai start`
```bash
macai start [options]
```

Options:
- `--tasks <file>` - Specify tasks file (default: `tasks.yaml`)
- `--hours <number>` - Maximum runtime in hours (default: 8)
- `--continue-on-failure` - Continue running after task failure
- `--repo <path>` - Target repository path (default: current directory)

#### `macai prompt`
```bash
macai prompt [options] "<natural language description>"
```

Options:
- `<description>` - Natural language task description
- `--dry-run` - Preview plan without executing
- `--continue-on-failure` - Continue running after task failure
- `--hours <number>` - Maximum runtime in hours (default: 8)
- `--repo <path>` - Target repository path (default: current directory)

#### `macai status`
```bash
macai status [options]
```

Options:
- `--repo <path>` - Target repository path (default: current directory)

#### `macai report`
```bash
macai report [options]
```

Options:
- `--repo <path>` - Target repository path (default: current directory)

#### `macai doctor`
```bash
macai doctor [options]
```

Options:
- `--repo <path>` - Target repository path (default: current directory)

#### `macai cleanup`
```bash
macai cleanup [--dry-run] [--force] [--older-than-days 7] [--no-prune-tasks]
```

Removes orphaned `macai/*` git worktrees, stale `worktree/` directories left on disk, and prunes `.macai/tasks/<id>/` folders for finished coding runs. **Keeps** task dirs with a non-empty `investigation-report.md` unless `--force` is passed. Uses `database.sqlite` task status when available.

Examples:
```bash
macai cleanup --dry-run              # preview removals
macai cleanup --older-than-days 14   # only prune dirs older than 14 days
macai review 02343b6b821986f0        # inspect before deleting
```

#### `macai review`
```bash
macai review <task-id> [--repo <path>]
```

Prints task status, mode, branch, worktree path, investigation-report preview, and recent git info when a branch exists.

## Sample templates

Example assets live under `templates/` (not repo root — `/sample-project/` at the root is gitignored):

- `templates/sample-project/` — minimal project for trying macai
- `templates/tasks.example.yaml` — example task definitions

Copy or point `--tasks` at the YAML when experimenting.

## Test coverage

```bash
npm test                 # unit tests
npm run test:coverage    # tests + v8 coverage summary
```

CI runs `npm test`, `npm run test:coverage`, and `npm run build` on push/PR to `main`.

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| `Ollama: fetch failed` | Start Ollama; check `macai doctor` and `ollama.baseUrl` in config |
| Run stops immediately | Default is stop-on-failure; inspect `.macai/tasks/*/run.log` |
| Tests fail in worktree | Worktrees link `node_modules` from main — run `npm install` in the repo root |
| Git dirty / commit blocked | Coding tasks use isolated worktrees; main branch stays untouched |
| Many `.macai/tasks/` folders | `macai cleanup --dry-run` — keeps investigation reports by default |
| Native module build failures | Install build dependencies: `sudo apt-get install python3 make g++` |

When building projects that use native modules like `better-sqlite3`, you may encounter build failures on Linux systems. To resolve this, ensure the following build tools are installed:
- Python 3
- Make
- C++ compiler (g++)

### For CI/CD environments

When running in CI/CD environments or containers, you may need to install additional build dependencies for native modules like `better-sqlite3`. Run:

```bash
sudo apt-get update && sudo apt-get install -y python3 make g++
```

## Configuration

Copy `macai.config.example.yaml` and customize limits, shell allowlists, and repo commands.

### Configuration Options

The configuration file supports the following options:

```yaml
provider: ollama

ollama:
  baseUrl: http://10.0.0.29:11434
  model: qwen3-coder:latest

limits:
  maxRuntimeHours: 8
  maxIterations: 200
  maxRetriesPerCommand: 3
  maxRetriesPerValidationCommand: 20
  maxFilesChanged: 50
  maxDiffLines: 2000
  commandTimeoutMs: 300000
  maxOutputBytes: 100000

shell:
  allowedCommands:
    - npm
    - npx
    - node
    - git
    - pnpm
    - yarn
    - python
    - cargo
    - go
  deniedPatterns:
    - "rm -rf"
    - "curl.*\\\\\\\\|"
    - ssh
    - scp

paths:
  forbidden:
    - .ssh
    - .env
    - credentials

# Override auto-detected repo commands if needed:
# repo:
#   test: npm test
#   lint: npm run lint
#   build: npm run build
```

## Development

```bash
npm run dev -- doctor
npm test
npm run test:coverage
```

## Contributing

We welcome contributions to macai! Here's how you can help improve the project:

### Getting Started

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes
4. Run tests: `npm test`
5. Run coverage: `npm run test:coverage`
6. Commit your changes: `git commit -am 'Add some feature'`
7. Push to the branch: `git push origin feature/your-feature-name`
8. Create a pull request

### Code Guidelines

- Follow existing code style and conventions
- Write clear, concise commit messages
- Include tests for new functionality
- Document your changes in the README when appropriate
- Keep changes focused and atomic

### Reporting Issues

If you find bugs or have feature requests, please:
1. Check existing issues to avoid duplicates
2. Create a new issue with detailed description
3. Include steps to reproduce (for bugs)
4. Label appropriately

### Pull Request Process

1. Ensure all tests pass
2. Update documentation as needed
3. Add yourself to the contributors list if this is your first contribution
4. Your PR will be reviewed and merged by maintainers

## License

MIT