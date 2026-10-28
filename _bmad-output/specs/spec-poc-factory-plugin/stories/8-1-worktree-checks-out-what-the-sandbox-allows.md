---
title: 'The worktree checks out what the sandbox allows; the sandbox is tested'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: 'c35e28bcdc7e25613e5e75ca1826653a9fd3e317'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Under the Claude Code sandbox, `git worktree add` fails on tracked files the sandbox refuses (`.vscode/*`, `.mcp.json`, `.gitmodules`, …). The error surfaces as `BAD_ARGS` and leaves the `factory/<run-id>` branch behind. Nothing tests the CLI's git under the sandbox (dry run 3 finding 1; CAP-4, CAP-12, AD-15, AD-35).

**Approach:** Apply `sprint-change-proposal-2026-10-28.md` sections 4.1 and 4.2. The contract docs are already edited (`c35e28b`); this story is code, tests and the README.
- The worktree checks out what it can: `--no-checkout`, `reset -q`, `checkout-index -a`, then skip-worktree on `ls-files --deleted`. Those paths are recorded as `stage_started.readonly_paths` and shown on the SCAFFOLD and Gate 1 cards.
- WRAP refuses to integrate a target that changed a read-only path, and any failed integration leaves the worktree as it was.
- A failed add deletes the branch it created.
- `EPERM`/`EACCES` becomes the new error `SANDBOX_DENIED`.
- `start` runs a sandbox preflight.
- `test/sandbox.test.ts` is a conformance test.

## Boundaries & Constraints

**Always:**
- Refused paths are learned from the checkout, never listed in code.
- New fields are additive within `v:1`, with no upcaster (AD-32). An absent or empty `readonly_paths` renders nothing, so old recordings replay unchanged.
- The detail text is exactly `Read-only in this run (the sandbox refuses them): <p1>, <p2>`.
- The integration-refusal text is exactly `The target changed <paths> since the run started, and the sandbox won't let the factory check them out. Merge by hand in your own terminal, or abandon.`
- `SANDBOX_DENIED` messages name the path (or `sandbox.network.allowLocalBinding` for the bind probe) and end with `the sandbox refused this; it is a factory defect, report it (AD-35)`.
- The preflight runs before `run_started` and writes no run state.

**Never:**
- A hard-coded protected-path list, sparse-checkout, a worktree outside `.claude/worktrees/`, or `excludedCommands`.
- Changing the final `--no-ff` merge path.
- Parsing git stderr to find refused files.
- Integrating via `merge-tree` (deferred).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Sandboxed brownfield | Repo tracks `.vscode/settings.json`, `.mcp.json`, `.gitmodules`, `.claude/commands/c.md`, `src/a.ts` | Worktree created. Those 4 are `S` in `ls-files -v` and form `readonly_paths` (sorted). `trackedClean` is true. `src/a.ts` edits commit and merge back `--no-ff`. |
| Unsandboxed / no refused paths | Any repo | `readonly_paths` is omitted from the event, and no detail line appears. |
| Target changed a read-only path | `diffNames(base..target)` ∩ `readonly_paths` ≠ ∅ | No merge attempted. The blocked merge card carries the refusal text. Worktree status is unchanged. |
| Integration fails without `MERGE_HEAD` | Merge exits non-zero, no conflict state | `reset -q --hard HEAD`, then untracked files that weren't there before are removed. Status equals the pre-merge status. The `cannot integrate` problem stays. |
| Add fails after the branch was created | Any step after `worktree add` throws | The partial worktree is removed (`worktree remove --force` and `worktree prune`). The branch is deleted only if this call created it. The error is rethrown. |
| `EPERM`/`EACCES` | fs errno in the `main` catch, or git stderr `Operation not permitted`/`Permission denied` in `gitOrThrow` | `{code:'SANDBOX_DENIED'}` naming the path or command, never `BAD_ARGS`. |
| Preflight fails | A probe throws `EPERM`/`EACCES` | `SANDBOX_DENIED` before any run dir or event. |

</frozen-after-approval>

## Code Map

- `src/cli/git.ts:69` `worktreeAdd`: the only worktree creator, called only by `prepareWorktree` (`src/cli/worktree.ts:22`). `gitOrThrow` (:17) throws `BAD_ARGS`. `mergeInto` (:138) only runs `merge --abort`, so it is not enough. `diffNames` is at :124.
- `src/cli/next.ts:204` `startScaffold`: builds the SCAFFOLD `stage_started { stage, port, worktree }`. `finishScaffold` (:268) runs `git.worktree_clean`. `wrapProbe` (:104): the integrate `mergeInto` call is at :115, and failures push strings into `problems`. The scaffold failure card is raised at :297.
- `src/core/events.ts:103` `stage_started` type: add `readonly_paths?: string[]` with an "additive" comment. Validation is hand-written (`REQUIRED`, :181) and needs no change.
- `src/core/reducer.ts:80-82,152-154`: copies `port`/`worktree` onto `RunState`. Do the same for `readonly_paths`.
- `src/core/cards.ts`: `gate1Card` (:93) and `scaffoldFailureCard` (:154) gain an optional `readonly` input that becomes `details`. `cardLines` (:27) already prints `details`. Callers: `schedule.ts:118` and `next.ts:297`.
- `src/core/projection.ts` (stage-card loop, about :341): the SCAFFOLD `BoardCard` gets `details` from `s.readonly_paths`. `src/dashboard/web/src/lib/types.ts` mirrors it, and `StageCard.svelte` renders it under the header. `NeedsCard.svelte:33` already renders `card.details`.
- `src/cli/brief.ts:223` `inputs`: for non-orienting roles with `readonly_paths`, add an input naming each file's main-checkout path (`root/<p>`), read only.
- `src/core/errors.ts`: add `SANDBOX_DENIED`. `src/cli/main.ts:35`: map errno `EPERM`/`EACCES` there.
- `src/cli/start.ts`: call the preflight after `refuseOtherBinding`/`REFUSED_EXCLUSIVE` and before `claimDir`. Paths: `worktreesDir`, `gitExcludeFile`, `repoDir`, `factoryHome` (`src/store/paths.ts`).
- Tests: `test/harness.ts` (`world`, `fails`), `test/pipeline.test.ts` (`toScaffold` :106; WRAP integration :1221/:1324/:1465), `test/worktree.test.ts`, `test/cli.test.ts`. Golden `test/fixtures/recordings/*.timeline.json` must stay unchanged.
- `README.md:36-60`: the sandbox section. `skills/factory/SKILL.md:41`: the sandbox-denial rule.

## Tasks & Acceptance

**Execution:**
- [x] `src/cli/git.ts`:
  - `worktreeAdd` runs the four steps: `worktree add --no-checkout`, `reset -q`, `checkout-index -a` (a non-zero exit is expected), then `skip-worktree` on `ls-files --deleted`. It returns the sorted skipped paths.
  - Clean up on failure as in the matrix. For the test, the git runner is an optional last parameter.
  - `gitOrThrow` maps sandbox stderr to `SANDBOX_DENIED`.
  - Add `restoreAfterFailedMerge(cwd, untrackedBefore)` to the integrate path.
- [x] `src/cli/worktree.ts`: `prepareWorktree` returns `{ path, readonly }`. On reuse it recomputes `readonly` from `ls-files -v` (`S`). Add `sandboxPreflight(root, hash)`:
  - create and remove a file under `worktreesDir(root)`;
  - open `gitExcludeFile` for append, write nothing, close;
  - write and remove a file under `repoDir(hash)`;
  - listen on, then close, `127.0.0.1:0`. This probe always runs; unsandboxed it always succeeds.
- [x] `src/cli/next.ts`:
  - `startScaffold` emits `readonly_paths` only when the list is non-empty.
  - `wrapProbe` checks the overlap first; otherwise it snapshots untracked files, merges, and restores on a failure without `MERGE_HEAD`.
  - Pass `state.readonly_paths` into the scaffold failure card.
- [x] `src/core/{events,reducer,cards,schedule,projection}.ts`, `src/dashboard/web/src/{lib/types.ts,components/StageCard.svelte}`, then rebuild `dashboard/dist`: carry the field and add the detail line on Gate 1, the scaffold failure card and the SCAFFOLD stage plate.
- [x] `src/cli/brief.ts`: add the read-only input for builder and reviewer roles.
- [x] `src/core/errors.ts`, `src/cli/main.ts`, `src/cli/start.ts`: add the code, the errno mapping and the preflight call.
- [x] `test/sandbox.test.ts` (new) and `.gitignore` (`test/.sandbox-tmp/`):
  - Build the fixture with plumbing only, under `test/.sandbox-tmp/`.
  - Detect the mode with a `.mcp.json` write probe, and print `sandbox conformance: sandboxed|unsandboxed` first.
  - Run `prepareWorktree`, `trackedClean`, `commitAll`, the refused integration (`wrapProbe` logic or the overlap helper), the final `mergeInto --no-ff`, and `sandboxPreflight`.
- [x] Unit and pipeline tests:
  - forced add failure leaves no branch;
  - preflight bind refusal (an injected listener failure) gives `SANDBOX_DENIED` and no run dir;
  - errno and stderr mapping;
  - a non-`MERGE_HEAD` integration failure restores status;
  - Gate 1 and SCAFFOLD details are present with paths and absent without.
- [x] `README.md`: refused tracked files are read-only for the run, `SANDBOX_DENIED` and the preflight, and the rule that `npm test` runs once from a sandboxed session after a Claude Code upgrade (the test's first line records the mode). Use `node --test test/*.test.ts`; there is no root package.json. `SKILL.md`: name `SANDBOX_DENIED` in the sandbox rule.

**Acceptance Criteria:**
- Given this sandboxed session, when `node --test test/sandbox.test.ts` runs, then it prints `sandboxed` and passes with `readonly_paths` = `.claude/commands/c.md, .gitmodules, .mcp.json, .vscode/settings.json`.
- Given a run on the existing fixtures, when it reaches Gate 1, then no detail line appears and the golden timelines are unchanged.
- Given a run with `readonly_paths`, when a builder brief is built, then it names the main-checkout path of each read-only file.

## Implementation Notes

- **Incident during implementation.** Under this sandbox, `git init` below the project dir is refused (`.git/config`). An early experiment's `init` failed silently, and the plumbing that followed ran against d2t-factory itself: `main` moved to an orphan commit, 5 index entries were overwritten, and a stray worktree/branch `run` appeared. The subagent restored `main` to `c35e28b` from the reflog, removed the worktree and branch, and reset the index. The working tree was never touched. I verified `main`, the index, the branches, the worktrees and `.mcp.json` afterwards. The conformance fixture therefore uses `--separate-git-dir` (`repo.git`) and `GIT_CEILING_DIRECTORIES`, so no fixture command can reach this repo again.
- **Bind probe.** It always runs (no settings reader). Its refusal is tested through the test-only env `FACTORY_TEST_BIND_DENIED`, the same style as `FACTORY_DASHBOARD_OFF`.
- **Brief input.** Goes to every non-orienting role (scaffolder, spec-writer, designer, slicer, builder, reviewers), not just builder and reviewers.
- **Git refusals.** `gitOrThrow` maps `Operation not permitted` / `Permission denied` in stderr to `SANDBOX_DENIED`. This only names the error: refused files are found with `ls-files --deleted`.
- **Restore after a failed merge.** `mergeInto` now returns `merging` (whether MERGE_HEAD was there). `integrateTarget` restores only a failure without MERGE_HEAD.
- **Tests.**
  - The new `test/sandbox.test.ts` prints `sandbox conformance: sandboxed` in this session and passes, with all four fixture files read-only.
  - Under the real sandbox it also showed a target adding a new file in `.vscode/` failing without MERGE_HEAD, and the worktree being restored.
  - Full suite: 454 pass, 1 pre-existing skip. Golden timelines unchanged. `dashboard/dist` rebuilt.

## Review Triage Log

Pass 1: Blind Hunter, Edge Case Hunter, Verification Gap.

**Patched:**
- **Renamed read-only path (edge, medium).** `changedReadonly` used `git diff` with rename detection, so a target that moved `.mcp.json` listed only the new name. Fix: add `--no-renames`.
- **Uncommitted edits discarded (edge + blind, medium).** On a failure without MERGE_HEAD ("local changes would be overwritten"), `reset --hard` discarded uncommitted tracked edits. Fix: restore only when the worktree was `trackedClean` before the merge.
- **Swallowed checkout failures (edge + blind, medium).** The `checkout-index` catch swallowed every failure, so ENOSPC or EIO would have been marked as sandbox read-only. Fix: rethrow unless `SANDBOX_DENIED`.
- **ARG_MAX (blind, low).** `update-index` got one argument per path, which a large refused tree could exceed. Direct fix: stdin with `-z`.
- **Crash between add and skip-worktree (edge, medium).** A crash there left a reused worktree reporting no read-only paths, and `add -A` would stage the deletions. Reuse only happens before SCAFFOLD's `stage_started`. Fix: reuse re-runs steps 2–4 through a shared `checkOut` helper, which returns every skip-worktree path (`reset -q` keeps the earlier bits, so `ls-files --deleted` alone would return `[]` on reuse).
- **EPERM without a path (edge + blind + verification gap "other", low).** `errorOf` blamed the sandbox for any EPERM/EACCES, including path-less ones such as a `kill` EPERM. Fix: only errors carrying `path` or `address` map to `SANDBOX_DENIED`.
- **Skip-worktree path tested only sandboxed (verification gap, medium).** Fix: a GitRun-seam test.
- **Gate 1 wiring untested (verification gap, low).** Gate 1's wiring to `s.readonly_paths` had no test. Fix: a schedule test.

**Deferred:**
- **No pipeline seam (verification gap, medium).** No test reaches `startScaffold` emitting `readonly_paths`, or `wrapProbe` refusing through `state.readonly_paths`. Without a seam, only the sandboxed conformance run and dry runs cover it.
- **New file in a refused dir (blind, medium).** A target that adds a new file in a refused dir (e.g. `.vscode/extensions.json`) gets the generic `cannot integrate …` problem, not the hand-merge text. This follows the matrix, but the human-facing text is weaker.
- **`.git` writes not probed (blind, maybe-false, medium if true).** The preflight doesn't probe the `.git` writes `worktree add` makes (`.git/worktrees/`, `refs/heads/factory/`). This session refuses `.git/config` under the cwd for a nested repo. To settle it: run `worktree add` from a sandboxed session on a real repo, which dry run 4 does.

**Rejected:**
- **Untracked files from other processes (edge, low).** The restore could delete untracked files other processes created during the merge window. The window is a single git command, and the fix is a new diff-based branch.
- **Empty dirs left (edge + blind, low).** Empty dirs left by the failed merge don't show in `git status`, so the status is as it was.
- **Ignored stray from the merge (edge + blind, low).** It would need a tracked target file that matches `.gitignore`, which is rare. The fix adds a second listing.
- **Throw from `integrateTarget` (edge + blind, low).** A `gitOrThrow` failure there escapes `next`. It fails loudly (`SANDBOX_DENIED` or `BAD_ARGS`), which is AD-35's error path, and the old `mergeInto` gave no stronger guarantee.
- **Assume-unchanged entries (blind, false).** `skippedPaths` would drop entries that are also assume-unchanged (`s`). The factory never sets assume-unchanged, and the worktree is created by the factory.
- **Failed `worktree remove` under the sandbox (edge, maybe-false, low).** The subagent saw cleanup and `branch -D` succeed under this sandbox (with a lock warning).
- **Branch-creation race (edge, false).** Runs are exclusive per repo (AD-15), so no other process creates `factory/<run-id>`.
- **Partial mkdir left by the preflight (edge, low).** A refused mkdir partway down can leave an empty `.claude/` in the repo, which is harmless. The fix is a new ancestor walk.
- **Empty exclude file (edge + blind, low).** The exclude probe can create an empty `.git/info/exclude`. `ensureExclude` would create it on any run anyway.
- **Greenfield init before the preflight (edge + blind, low).** Greenfield `git init` and `factory: init` run before the preflight. They are not run state, a retry is idempotent, and the preflight needs the repo hash.
- **Newer main-checkout copy (blind, false).** Agents may read a newer main-checkout copy of a read-only file. That is AD-15's decision (agents read from the main checkout).
- **Spec-writer and slicer not told (blind, false).** They are told: the brief input goes to every non-orienting role and says "change nothing".
- **Test env var in production code (blind, low).** There is precedent (`FACTORY_DASHBOARD_OFF`, `FACTORY_CLAUDE_AGENTS_JSON`).
- **Mode line ordering (blind, low).** The README's "first line" claim may not hold under `node --test`. In practice the line is printed (seen in this session's run).
- **"Them" for a single path (blind, false).** The refusal text is fixed verbatim by the frozen intent.
- **`readonly_paths` never cleared (blind, false).** SCAFFOLD's `stage_started` is recorded once per run.
- **Fixture left on setup throw (blind, low).** It is gitignored, and the per-run dir is removed in `t.after`.
- **Permission denied (publickey) (blind + verification gap, false).** The CLI runs no remote git.

## Spec Change Log

## Verification

**Commands:**
- `node --test test/*.test.ts`: expected all pass, both sandboxed and unsandboxed.
- `cd src/dashboard/web && npm run build`: expected `dashboard/dist` updated.
