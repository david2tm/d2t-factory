# d2t-factory

A software factory for Claude Code. `/factory <task>` drives a run through INTAKE → RECON/FRAME → SCAFFOLD → SPEC (+ design) → SLICE PLAN → BUILD → WRAP. The `factory` CLI owns sequencing, hooks record what actually happened, and every gate and merge waits for a command the human typed. A local dashboard shows each run as a lane, marking claims as verified or not.

The contract lives in `_bmad-output/specs/spec-poc-factory-plugin/SPEC.md`. Open issues from the first dry run: `_bmad-output/implementation-artifacts/dry-run-findings.md`.

## Before the first run (once per machine)

### 1. Tools

| Tool | Why |
|---|---|
| macOS, git | the factory makes a git worktree per run |
| Node ≥ 22.18 | the CLI and hooks use type stripping and `node:sqlite` |
| Claude Code | the conductor; any version with plugins, `EnterWorktree` and background agents |
| `npx` + Google Chrome | the UI reviewers' Playwright MCP servers (`.mcp.json`) start through `npx` and drive Chrome headless |

### 2. Check the plugin itself

```sh
cd ~/Projects/d2t-factory
node --test test/*.test.ts
```

### 3. Run `factory setup` in your own terminal

```sh
~/Projects/d2t-factory/bin/factory setup
```

Run it outside Claude Code: the Claude sandbox can't create `~/.factory` or write `~/.claude/settings.json`. Setup is idempotent. It:

- creates `~/.factory` (state, run artifacts, dashboard cache) and records the current Node at `~/.factory/node`, so a target repo's `.nvmrc` / Volta / asdf can't swap Node under the hooks;
- merges its entries into `~/.claude/settings.json`, keeping a one-time backup at `settings.json.before-factory`.

### 4. Finish `~/.claude/settings.json` by hand

Setup adds everything below except `sandbox.network.allowLocalBinding`. Without it, the sandbox refuses to let the dashboard and the target app's dev server listen on a port (`listen EPERM`).

```json
{
  "permissions": {
    "additionalDirectories": ["~/.factory"],
    "allow": ["EnterWorktree", "Bash(factory:*)"]
  },
  "sandbox": {
    "enabled": true,
    "filesystem": { "allowWrite": ["~/.factory"] },
    "network": { "allowLocalBinding": true }
  }
}
```

- `additionalDirectories` and `allowWrite`: the conductor and agents read and write run artifacts under `~/.factory`.
- `EnterWorktree`: the conductor enters the run's worktree without a prompt.
- `Bash(factory:*)`: the conductor calls the CLI without a prompt.

The `sandbox` block is only needed when you run with the sandbox on. The dry run used `"defaultMode": "bypassPermissions"`. In a stricter mode, expect permission prompts from the builder and reviewer agents.

The factory never runs a command outside the sandbox and never asks you to change it mid-run. If a run fails on a sandbox denial, that's a factory bug: report it. Setup and the settings above cover what the factory needs.

What the sandbox means for a run:

- **Some tracked files are read-only for the run.** The sandbox refuses writes to some paths under the session's directory whatever the writable roots are (in Claude Code 2.1.312: files in `.vscode/`, `.idea/`, `.claude/commands/`, `.claude/agents/`, plus `.mcp.json`, `.gitmodules` and a few others). The worktree checks out every tracked file it can and leaves the refused ones out, marked skip-worktree. The factory keeps no list: whatever your Claude Code refuses is what is left out. The SCAFFOLD and Gate 1 cards name them (`Read-only in this run (the sandbox refuses them): …`). Agents read them from the main checkout, commits never touch them, and the final merge leaves them as they are. If your branch changes one of them during the run, WRAP won't integrate it; merge by hand in your own terminal, or abandon.
- **`SANDBOX_DENIED`.** A file or git operation the sandbox refuses is reported as this error, naming the path, and the conductor prints it and stops. It is a factory defect: report it rather than loosening the sandbox.
- **The preflight.** `/factory <task>` first checks, inside the sandbox, that it can create a file under `<repo>/.claude/worktrees/`, open `.git/info/exclude` for append, write under `~/.factory/<repo-hash>/` and listen on `127.0.0.1`. If any check is refused, the run doesn't start (`SANDBOX_DENIED`, naming the path, or `sandbox.network.allowLocalBinding` for the listener) and nothing is written.
- **After every Claude Code upgrade**, run the tests once from a sandboxed Claude Code session in this repo, before the next run: `node --test test/*.test.ts` (there is no root `package.json`, so no `npm test`). `test/sandbox.test.ts` runs the CLI's git under the session's sandbox. Its first line, `sandbox conformance: sandboxed` (or `unsandboxed`), records which mode ran; note it in the dry-run checklist.

### 5. A launcher

The factory loads per session with `--plugin-dir`. Nothing is installed into Claude, nothing lands in the target repo, and edits to the plugin take effect in the next session.

```sh
# ~/.zshrc
alias claude-factory='claude --plugin-dir ~/Projects/d2t-factory'
```

## Each run

1. `cd` to the target repo's main checkout, with a clean `git status`.
2. `claude-factory`
3. `/factory <task>`. The first answer prints `Dashboard: http://127.0.0.1:4870`. Keep it open.
4. Answer each card by typing one of its commands (`/factory approve intake`, `/factory approve gate1`, …). Plain chat never passes a gate.
5. Bare `/factory` resumes after `/clear` or a restart. Inside a run's worktree, it resumes that run. In the main checkout with several live runs, it lists them.

### Worktree isolation

Each run already gets its own git worktree, branch (`factory/<run-id>`) and port. The CLI creates the worktree at `<repo>/.claude/worktrees/factory-<run-id>` and keeps it out of `git status` through `.git/info/exclude`. Nothing needs enabling. Don't start the factory session with `claude --worktree`: the factory makes its own worktree, and the two haven't been tried together.

## Optional: Ghostty + tmux

They make it easier to keep the conductor, a shell in the worktree and the dashboard side by side, and to run two sessions for parallel runs.

```sh
brew install --cask ghostty
brew install tmux
```

- Ghostty has native splits: `cmd+d` splits right, `cmd+shift+d` splits down.
- A tmux session survives closing the terminal: `tmux new -s factory`, detach with `ctrl-b d`, return with `tmux attach -t factory`.
- Claude Code's own `claude --worktree --tmux` opens a session in a new worktree inside tmux. It's handy for side work in this repo, but not for factory runs (see above).

## Reset after a run

Stop the run's processes, then remove its worktree, branch and state. Run these in your own terminal, because the Claude sandbox blocks signals to other processes and writes outside the session's directory.

Finished and abandoned runs keep their worktrees. From the target repo, `~/Projects/d2t-factory/bin/factory prune` lists the worktrees of merged or abandoned runs (plus any git marks prunable) and prints the exact `git worktree remove`, `git worktree prune` and `git branch -D` commands to run. It runs none of them itself.

```sh
lsof -t -iTCP:4870 -sTCP:LISTEN | xargs kill                          # the dashboard
lsof -t -iTCP:<run port> -sTCP:LISTEN | xargs kill                    # the run's dev server

cd <target repo>
git worktree remove --force .claude/worktrees/factory-<run-id>
git branch -D factory/<run-id>
sed -i '' '/^\.claude\/worktrees\/$/d' .git/info/exclude              # last run only
rm -rf .claude

cd ~/.factory && rm -rf <repo-hash> cache.sqlite dashboard.* inbox ports sessions recordings
```

`~/.factory/node`, `plugin-env.json` and `playwright/` are machine setup, not run state. They can stay.
