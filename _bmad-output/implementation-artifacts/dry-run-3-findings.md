# Dry run 3 — findings (2026-10-28)

Brownfield dry run after epic 7 and deferred batch 2. Brownfield on `maciekt07/TodoApp` again (base `426d979`), task "add an optional task giver field when a new task is added". Run `i-want-to-add-an-optiona-7sdp`, Claude Code 2.1.312, sandbox on. The run stopped at the start of SCAFFOLD on finding 1, and dry run 3 ended there.

**Passed:** `factory start`, session binding, the INTAKE conversation and confirm card (6-2: task and scope shown, no time limit, `/factory approve intake` verified from the hook fact), and RECON (one agent, output verified, recon cached by base sha, `git.baseline` clean twice).

**Evidence kept:** the run was cleaned up afterwards: the run state under `~/.factory/1792c4b32ddf/`, its session binding, inbox and port 5100 lease, and the empty branch `factory/i-want-to-add-an-optiona-7sdp` (tip = base, no commits) in TodoApp. Archived first in `~/.factory/archive/dry-run-3-2026-10-28/`: `run.tgz` (event log, facts, artifacts, recon, session binding, inbox, port lease) and `dashboard.log`. No worktree was ever created, so there is no branch bundle or Playwright output. The Claude session transcripts are untouched (`~/.claude/projects/-Users-d2t-Projects-TodoApp/44058f46-1c6a-4d28-b625-0d630d732293.jsonl`).

Recorded as observations only. Decisions come later.

| # | Kind | Finding | Evidence |
|---|---|---|---|
| 1 | **blocker** | The sandbox blocks the CLI's `git worktree add` at SCAFFOLD. TodoApp tracks `.vscode/settings.json` (since 2024), and the sandbox refuses any write under a `.vscode` dir, inside the session's own working tree too. Git can't check that file out, so the worktree isn't created (`worktreeAdd`, `src/cli/git.ts:69`). Dry run 2 created a worktree from the same repo, file and path with the same `~/.claude/settings.json` (unchanged since 10-25) on Claude Code 2.1.310, so the protected path most likely came with 2.1.312 (not checked against the changelog). Other protected IDE or agent config paths (`.idea`, `.claude/settings*.json`, `.git/hooks`) would fail the same way. Two smaller points: the error comes back as `BAD_ARGS`, which reads as a conductor mistake rather than a sandbox refusal, and the run branch is left behind with no worktree. | transcript `44058f46…` line 147: `git worktree add …/.claude/worktrees/factory-i-want-to-add-an-optiona-7sdp … error: unable to create file .vscode/settings.json: Operation not permitted`, `fatal: Could not reset index file to revision 'HEAD'`, `"sandboxed":true`; in a 2.1.312 sandboxed session, `mkdir .vscode` → `Operation not permitted`, `mkdir .vscode-probe-dir` → ok; dry run 2 transcript `ad8af104…` is version 2.1.310 |
| 2 | UX (enhancement) | The factory never tells the human when `/clear` is safe or why they might want it. The conductor's context grows from INTAKE to WRAP. Resume after `/clear` works (spike 06 rebind; the first command typed resumes the run), but nothing says so. Idea, not decided: the CLI adds one line to a card, e.g. "Safe to `/clear` here: the run is saved. After clearing, type one of the commands above." The card's own commands are the suggested next prompt, since Claude Code never starts a turn after `/clear` by itself. The line shows only when nothing else is in flight (background agents, checks or a `--wait`; clearing orphans their notifications and forces a reissue), never during the INTAKE conversation (it lives only in chat until the intake file is written), and not on the WRAP merge card until the deferred `ExitWorktree`-after-`/clear` item is settled. The dashboard's Needs You card would render the same line. | `cardLines`, `src/core/cards.ts:27`; `skills/factory/SKILL.md:32`; spike-results.md spike 06 |

## Finding 1 needs a proper solution, not another patch

Finding 1 is dry run 1 finding 1 coming back: `factory setup` doesn't prepare the sandbox for what the factory needs, and nothing checks the factory against the sandbox. Every dry run has hit it, and each time it was patched for one symptom only:

- Dry run 1 (finding 1): no local port binding. `setup` now warns when `allowLocalBinding` is missing, and `dashboard.log` `listen EPERM` names the setting.
- Dry run 2 (finding 3): `/factory merge` couldn't write the main checkout from inside the worktree. Fixed by leaving the worktree before the merge. Same run: post-merge `git worktree remove` was refused on the entered worktree's protected `.git`. Worked around by keeping worktrees and adding `factory prune`.
- Dry run 3 (finding 1): `git worktree add` can't write a tracked `.vscode/` file.

What the three share: the sandbox's write rules (writable roots, cwd-scoped writes, built-in protected paths) are a moving input that changes between Claude Code versions, and every git or filesystem operation the CLI runs depends on it. No test runs any of those operations under the sandbox, so each change is found in a dry run. A proper solution has to treat the sandbox as a designed dependency, not a list of exceptions. That means at least:

- knowing which paths the sandbox refuses and why, for the version in use (a spike, the same way spike 06 pinned `/clear`);
- a decision for every CLI git or filesystem operation on where it runs, under which cwd, and what happens when the target repo holds protected paths (for example, a checkout that skips or defers them, or running outside the sandbox on purpose and recording that);
- a check in `factory setup` (or at `factory start`) that fails early with a clear message rather than at SCAFFOLD with `BAD_ARGS`;
- a test that runs these operations under the real sandbox, so the next Claude Code upgrade breaks a test rather than a dry run.

This touches AD-15 (worktree placement and entry) and AD-35 (the sandbox stance), so it is an architecture-level change and goes through Correct Course, not a quick fix.

## Not reached

SCAFFOLD onward: SPEC, design, the slice plan, BUILD and reviewers, WRAP and the merge, recording and replay. The five `[dry run 3]` items in `deferred-work.md` are all unverified and carry over to the next dry run: `ExitWorktree` after `/clear` before the merge (high if true), the husky + commitlint merge, linters and test runners crawling the kept worktrees, a real interactive recording as a replay fixture, and the optional spike 02 rerun.
