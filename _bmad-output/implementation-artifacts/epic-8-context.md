# Epic 8 Context: Dry Run 3 Product Changes

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Dry run 3 (brownfield TodoApp, sandbox on) stopped at the start of SCAFFOLD. `git worktree add` failed because the sandbox refuses writes to some tracked files (`.vscode/settings.json`) whatever the writable roots are. The error came back as `BAD_ARGS`, and the run branch was left behind with no worktree. Every dry run so far has hit a different symptom of the same root cause: the factory treated the sandbox as a list of exceptions that setup patches, and no test ran the CLI's git under it. This epic makes the worktree check out whatever the sandbox allows. Refused files become read-only for the run, and the sandbox becomes a designed dependency: `factory start` probes it, errors name it, and a test runs it. Separately, cards tell the human when `/clear` is safe. 8-1 blocks dry run 4 and 8-2 is small. Stories 0-1 to 7-2 stay valid, and this epic adds no process, route or dependency. **Contract edits:** every edit the proposal lists is already applied in the repo: SPEC's sandbox constraint, spine AD-15, AD-35, AD-34 `clear_safe`, the `SANDBOX_DENIED` error code and the spike-09 Open Questions row, the two EXPERIENCE rows (SCAFFOLD detail, gate/escalation message), spike-results section 09, and deferred-work. DESIGN needs no edit. Still to apply as part of the stories: all code and tests (no `SANDBOX_DENIED`, `readonly_paths`, `clear_safe` or `test/sandbox.test.ts` exists yet), plus the README update in 8-1.

## Stories

- Story 8.1: The worktree checks out what the sandbox allows; the sandbox is tested
- Story 8.2: Cards say when /clear is safe

## Requirements & Constraints

- **Sandbox constraint.** Factory sessions still run every command inside the sandbox and never ask the human to loosen it. Tracked files the sandbox refuses are read-only for the run and named on its cards. `factory start` refuses early, naming the sandbox, when the factory can't work under it.
- **SCAFFOLD (CAP-4).** On a brownfield run the worktree still has no tracked changes at SCAFFOLD done, so `git.worktree_clean` passes with refused files present.
- **Isolation (CAP-12).** The worktree still lives under `<repo>/.claude/worktrees/` with no new entry in the main checkout's `git status`.
- **Resume (CAP-1).** Resume after `/clear` already works. 8-2 only tells the human when it is safe.
- **8-1 acceptance.**
  - A fixture repo under a sandboxed session reaches SCAFFOLD done with `readonly_paths` equal to the four refused files.
  - Edits to `src/a.ts` commit and merge back.
  - A target change to `.vscode/settings.json` raises the integration card, and the worktree status is unchanged.
  - A forced `worktree add` failure leaves no `factory/<run-id>` branch.
  - `start` without `allowLocalBinding` in a sandboxed session refuses with `SANDBOX_DENIED` before `run_started`.
- **8-2 acceptance.**
  - Gate 1 and gate 2 cards carry the line.
  - An escalation card raised while another slice's reviewer is running does not.
  - The merge card never does.
- **Epic success.**
  - Dry run 4 on TodoApp (sandbox on, Claude Code 2.1.312+) passes SCAFFOLD with `.vscode/settings.json` read-only.
  - `npm test` run from a sandboxed session reports sandboxed mode and passes.

## Technical Decisions

- **Worktree creation (AD-15, 8-1).** One git command becomes four:
  1. `git worktree add --no-checkout <path> -b factory/<run-id> <base_sha>`;
  2. `git reset -q` in the worktree (index only);
  3. `git checkout-index -a`, which writes every file it can;
  4. every tracked file still missing (`git ls-files --deleted`; never parse stderr) gets `git update-index --skip-worktree`.

  The skipped files are recorded as `stage_started.readonly_paths` on SCAFFOLD. If the add fails after it created the branch, the CLI deletes that branch. `paths.ts` still owns the location, and the `.git/info/exclude` and gitignored-file copy steps stay as they are.
- **Learned, not listed.** Keep no list of protected paths anywhere. Whatever the installed Claude Code refuses is what gets skipped. With the sandbox off, or in a repo without such paths, the list is empty and nothing shows. Spike 09's list (`.vscode/*`, `.idea/*`, `.claude/commands|agents/*`, `.git/hooks/*`, `.gitmodules`, `.mcp.json`, shell rc files and others, under the session cwd at any depth) is reference only. Sparse-checkout, worktrees under `~/.factory` and `excludedCommands` were all rejected.
- **Read-only semantics.**
  - Agents read refused files from the main checkout path in their brief.
  - A write to one fails on the sandbox denial: the ordinary AD-35 failure path, naming the file.
  - `git add -A` honours skip-worktree, so commits and the final merge never touch these files.
  - Builders never run git (AD-8), so nothing clears the skip-worktree bits.
- **WRAP integration (AD-8/AD-15, 8-1).**
  - Before integrating the target, the CLI checks `git diff --name-only <base>..<target>` against `readonly_paths`. On any overlap it doesn't integrate, and WRAP raises the card without the merge.
  - A failed integration of any kind must leave the worktree as it was. Spike 09 showed git can write new files and fail without a `MERGE_HEAD`, so `mergeInto`'s abort alone is not enough.
  - The final `--no-ff` merge path is unchanged.
- **`SANDBOX_DENIED` (8-1).**
  - A git or filesystem `EPERM`/`EACCES` in the CLI maps to this new code, never to `BAD_ARGS`.
  - The message names the path and says it is a factory defect to report (AD-35).
  - The conductor's existing error rule applies: print it in one line, end the turn, never suggest a settings change (7-1).
- **`start` preflight (AD-35, 8-1).** Before any state is written (before `run_started`), the CLI process probes:
  - creating and removing a file under `<repo>/.claude/worktrees/`;
  - opening `.git/info/exclude` for append without writing;
  - writing under `~/.factory/<repo-hash>/`;
  - binding `127.0.0.1:0`, only when `settings.json` enables the sandbox.

  A failed probe refuses with `SANDBOX_DENIED` and names the path or the `allowLocalBinding` setting.
- **Conformance test (8-1).** `test/sandbox.test.ts`:
  - Builds its fixture with plumbing only (`hash-object`, `update-index --cacheinfo`, `commit-tree`), tracking `.vscode/settings.json`, `.mcp.json`, `.gitmodules` and `src/a.ts`.
  - Puts the worktree in a gitignored `test/.sandbox-tmp/` under the session cwd.
  - Runs the real `prepareWorktree`, `trackedClean`, `commitAll`, a refused integration, the final merge and the preflight.
  - Detects the sandbox by probing a `.mcp.json` write. Sandboxed, it asserts the refused paths are `readonly_paths`. Unsandboxed, it asserts the list is empty and everything else passes the same way.
  - Its first output line states the mode.
  - Known limit, accepted: the cwd-inside-worktree case stays covered by dry runs only.
- **`clear_safe` (AD-34, 8-2).**
  - `next` sets `Card.clear_safe: true` when the run is parked (`isParked`, AD-12: every open step waits on the human) and the card is not `merge`.
  - The merge card stays excluded until `ExitWorktree` after `/clear` is settled. INTAKE has no card. The intake confirm card qualifies.
- **Events (AD-32).** The two new fields, `stage_started.readonly_paths` and `Card.clear_safe`, are additive within `v:1`, so there is no upcaster. Old recordings must replay unchanged: no read-only detail and no clear line.

## UX & Interaction Patterns

- **Read-only detail.** The SCAFFOLD and Gate 1 cards (board and chat) carry the detail `Read-only in this run (the sandbox refuses them): .vscode/settings.json, .mcp.json`. It is absent when the list is empty.
- **Integration refusal.** The WRAP card without the merge says: "The target changed <paths> since the run started, and the sandbox won't let the factory check them out. Merge by hand in your own terminal, or abandon."
- **Clear line.** `cardLines` appends one line after the reply: "Safe to `/clear` here: the run is saved. After clearing, type one of the commands above." The Needs You card renders the same line from the same source. Chat and board never diverge.

## Cross-Story Dependencies

- **Order.** Build 8-1 first: it blocks dry run 4. 8-2 is independent and can follow.
- **What 8-1 amends.**
  - 1-4: worktree creation.
  - 1-5: WRAP integration and merge.
  - 1-1: `factory setup`, error codes and the README sandbox section.
  - 7-1: what a sandbox denial looks like.
- **What 8-2 amends.**
  - 6-2: `cardLines`.
  - 2-2: the Needs You card.
- **Deferred, not in scope.**
  - Integrating a target that changed a refused path in the object database (`merge-tree` + `commit-tree`).
  - Why `mkdir .vscode` was refused in dry run 3 but allowed in spike 09.
