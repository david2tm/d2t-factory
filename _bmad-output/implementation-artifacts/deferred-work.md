- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/0-1-run-increment-0-spikes.md`
  summary: Rerun spike 02 (forgery) cleanly, with five non-overlapping attempts and a builder held in the foreground.
  evidence: The run was invalid because the conductor backgrounded the builders and a model safeguard stopped the sandbox-on run. The python and symlink attempts were never exercised. A clean run needs `claude --agent` or a foreground-only conductor, and must not try to get around safeguards.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/1-2-factory-cli-driver.md`
  summary: Check whether a genuine prompt can be consumed as forged because one prompt fact or the transcript turn is not yet written when `decide` runs (unverified, medium if true).
  evidence: `newestPrompt` consumes a group missing `human` or `text`, or with no matching turn, as `forged` at once. The prompt hooks are synchronous (AD-13), but transcript flush timing is unverified. 1-3's hooks shipped, but the timing has still not been watched live. Settle it in a real `claude --plugin-dir .` session; if it can happen, leave incomplete groups unconsumed instead.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/1-5-build-review-wrap-and-record.md`
  summary: Decide whether the human-approved final `--no-ff` merge should skip the target repo's hooks or use a message those hooks accept (unverified, medium if true).
  evidence: `mergeRun` runs the user's commit-msg and pre-merge-commit hooks, so a commitlint hook that rejects `factory: merge …` makes every merge fail. The card still offers the merge, but no retry can pass. Settle with a husky + commitlint brownfield repo.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/2-2-dashboard-board-ui.md`
  summary: Build the AD-16 fallback: when `dashboard/dist` is missing, build the board into the plugin data directory (never under `${CLAUDE_PLUGIN_ROOT}`) and serve it from there.
  evidence: 2-2 commits `dashboard/dist`, so the server finds a build and the fallback is never exercised. Without dist, `src/dashboard/server/http.ts` still serves its placeholder page at `/` and `/replay/<name>`. The fallback needs the web package's dev deps at runtime (or a vendored build step), plus a data-dir path in `store/paths.ts` that the server checks before the placeholder.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/4-1-replay-engine-for-single-run-recordings.md`
  summary: Make a real interactive increment 1–3 recording (never `claude -p`) and add it to `test/fixtures/recordings/` with its `buildTimeline` snapshot as a regression fixture.
  evidence: 4-1 ships synthetic fixture recordings only (decided 2026-10-25); no real recording existed under `~/.factory/recordings/` when it was planned.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/4-1-replay-engine-for-single-run-recordings.md`
  summary: Test the replay wiring in `App.svelte`: the board clock is `playback.t`, Needs You announcements are suppressed at 16× with one summary when it stops, and a drawer whose source is gone after a seek closes with focus on the timeline.
  evidence: These live only in the component, and the repo has no Svelte component-test harness. Swapping the clock to `stream.now` or deleting the 16× suppression leaves the suite green (4-1 review, row 19). The pure helpers (`needsSummary`, `selectionPresent`, `replayShortcut`) are tested.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/5-1-parallel-runs-and-multi-run-recording.md`
  summary: Decide whether a second run's scaffolder and SCAFFOLD checks should be kept off a shared service before the exclusive claim settles, since today `contract.health` and `contract.test` run against it before `finishScaffold` refuses the run.
  evidence: AD-15 claims `exclusive/` at SCAFFOLD, but the run contract only exists after the scaffolder has worked in the repo, so a run started before another run claimed can touch the shared DB until its own SCAFFOLD ends. Claiming when the scaffolder reports would narrow the window without closing it. Closing it needs a declared-services probe at start, or holding SCAFFOLD for every run while any claim is held (5-1 review, BH2).
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-small-fixes-and-tests.md`
  summary: Make `factory check`'s `sh()` fail a check that hit the timeout: today, when `sh` exits 0 but a backgrounded grandchild keeps stdout open, `spawnSync` waits the full timeout and the check records exit 0 (passed).
  evidence: Reproduced with sh()'s spawnSync options, timeout 500 ms: `sleep 8 & echo started` returned after 502 ms with status 0 and `error.code` ETIMEDOUT. `sh()` reads only `r.status ?? 124` and ignores `r.error`, so contract.test would pass after waiting CHECK_TIMEOUT_MS (10 min).
- source_spec: `_bmad-output/implementation-artifacts/spec-deferred-small-fixes-and-tests.md`
  summary: Kill a check command's whole process group on timeout, so backgrounded grandchildren don't outlive `factory check`.
  evidence: Reproduced: after `spawnSync('sh', ['-c', 'sleep 7.77 & echo $!'], { timeout: 500 })` returned, `process.kill(pid, 0)` on the printed pid succeeded, so the sleep was still alive. spawnSync signals only `sh`. The original "hangs" concern did not reproduce: spawnSync returns at the timeout even while a grandchild holds stdout.

- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/6-2-cards-say-whats-next-intake-scope-optional-time-limit.md`
  summary: The agreed intake task and scope (and out-of-scope items) never reach the spec-writer, slicer or builders; briefs use the raw `factory start` task.
  evidence: `briefText` writes `task: ${state.task}` (src/cli/brief.ts) and no brief includes the intake out.md, so out-of-scope items the human settled at INTAKE are not passed to SPEC or SLICE PLAN. Pre-existing (the intake body never reached agents either); 6-2 only shows them on the confirm card.

- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/6-3-claim-waiting-states-and-pinned-artifact-view.md`
  summary: Drawer focus return is lost when a claim chip or artifact button inside the Decision drawer swaps the drawer's content and the drawer is then closed.
  evidence: The in-drawer opener passes its own `data-src` (`srcId(...)`), and that element no longer exists after the swap, so `closeDrawer` (lib/drawer.ts) finds nothing to focus. The pattern predates 6-3 (the in-drawer ClaimChip); the fix is to carry the drawer's original `sel.src` through.

- source_spec: `_bmad-output/implementation-artifacts/spec-dry-run-2-wrap-merge-fix.md`
  summary: Unverified (high if true): after `/clear` inside the worktree, `ExitWorktree` may be a no-op, so the pending merge's `exit_worktree` never verifies and the run reaches the reissue cap instead of merging.
  evidence: ExitWorktree's docs say it only acts on worktrees entered with EnterWorktree "in this session", and the session's cwd survives `/clear` (AD-15). Settle it in dry run 3: `/clear` inside the worktree before `/factory merge`, then check that ExitWorktree returns the session to the main checkout. Before this change the same gap only skipped housekeeping; now it blocks the merge.

- source_spec: `_bmad-output/implementation-artifacts/spec-dry-run-2-wrap-merge-fix.md`
  summary: Under the sandbox, the CLI's post-merge `git worktree remove` fails for the worktree the conductor entered, so a successful run ends with `worktree_error` and the worktree left behind.
  evidence: Sandboxed check on 2026-10-26: after EnterWorktree(path) then ExitWorktree(keep), deleting `<wt>/.git`, `<wt>/.claude/.cc-writes` and `.git/worktrees/<name>/commondir` gave "Operation not permitted"; a worktree the session never entered was removed fine. Removal failure is already non-fatal and reported.

- source_spec: `_bmad-output/implementation-artifacts/spec-dry-run-2-worktree-exit-and-removal.md`
  summary: Kept run worktrees pile up under `<repo>/.claude/worktrees/` with their installs and copied gitignored files (`.env`). Tools run from the main checkout may see them as duplicate projects.
  evidence: The human chose to keep worktrees silently (the sandbox blocks removal). `.git/info/exclude` hides them from git only. Jest's haste map, ESLint or `tsc` run in the target's main checkout may crawl `.claude/worktrees/*` and find duplicate modules or tests (unverified; settle on a brownfield repo with Jest after two runs). A cleanup recipe for the human's own terminal, or a `factory prune` printing one, would cover both.
