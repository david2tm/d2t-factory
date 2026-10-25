- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/0-1-run-increment-0-spikes.md`
  summary: Rerun spike 02 (forgery) cleanly, with five non-overlapping attempts and a builder held in the foreground.
  evidence: The run was invalid because the conductor backgrounded the builders and a model safeguard stopped the sandbox-on run. The python and symlink attempts were never exercised. A clean run needs `claude --agent` or a foreground-only conductor, and must not try to get around safeguards.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/0-1-run-increment-0-spikes.md`
  summary: Decide the browser driver for sandboxed reviewers, and verify Playwright MCP isolation before increment 3.
  evidence: Spike 04 found `npx agent-browser` can't run under the sandbox: npm hits EPERM on `~/.npm`, and the daemon dies at startup. The Playwright MCP fallback's own isolation check was never run.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/1-1-plugin-skeleton-and-functional-core.md`
  summary: Harden the AD-29 run lock (`src/store/locks.ts`) against two crash-window edge cases, alongside 1-2's real contention.
  evidence: (1) Two breakers that both see the same dead owner can both rename the lock aside, so the second rename may steal a lock a third process has just acquired. (2) A holder that dies between `mkdir` and writing `owner.json` leaves a lock that never goes stale, because a missing owner counts as live. Both need a crash in a tiny window; 1-1 deferred them by design.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/1-1-plugin-skeleton-and-functional-core.md`
  summary: Test `factory setup` temp-file cleanup when the rename onto `settings.json` fails after the tmp write succeeds.
  evidence: The read-only-dir test fails at the backup copy before any tmp file exists, so deleting the `rmSync(tmp)` line in `src/cli/setup.ts` keeps all tests green. A portable way to fail only the rename (e.g. injectable fs, or `chflags uchg` on macOS) is needed.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/1-1-plugin-skeleton-and-functional-core.md`
  summary: Decide how an open step on a cut, voided or rerun-cleared slice gets closed, since the AD-3 one-open-step-per-role rule otherwise blocks that role for the rest of the run (unverified, medium if true).
  evidence: The reducer has no cancel/close transition except `step_verified`; `cut_decided` accepts ESCALATED slices whose builder step may still be claimed. Settled by 3-4's escalation flow: if the builder step always reports and verifies before a cut or rerun, this cannot happen; otherwise `openSteps` needs to skip such steps or a `step_cancelled` command is needed.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/1-2-factory-cli-driver.md`
  summary: Make `matchTurn` compare the transcript turn canonically (command name in {factory, d2t-factory:factory} plus args equal to the prompt's args) instead of the rebuilt `/<name> <args>` string against raw `prompt_text` (unverified, high if true).
  evidence: Spike 02 recorded `command_name: d2t-factory:factory` for a typed `/factory approve gate2`, so the transcript's `<command-name>` may be the namespaced form; extra spaces after `/factory` also break the string match. If so, every genuine decision fails as "transcript mismatch". Settle with 1-3's real hooks by reading one real plugin-command turn.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/1-2-factory-cli-driver.md`
  summary: Check whether a genuine prompt can be consumed as forged because one prompt fact or the transcript turn is not yet written when `decide` runs (unverified, medium if true).
  evidence: `newestPrompt` consumes a group missing `human` or `text`, or with no matching turn, as `forged` at once. The prompt hooks are synchronous (AD-13), but transcript flush timing is unverified. Settle under 1-3's real hooks; if it can happen, leave incomplete groups unconsumed instead.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/1-2-factory-cli-driver.md`
  summary: Test that `factory claim --agent-id` records `agent_id` on `step_claimed` and in `status`.
  evidence: No test passes `--agent-id`; dropping the flag keeps all tests green. Agent claims first matter with 1-4's agent steps, and AD-7 attribution depends on them.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/1-2-factory-cli-driver.md`
  summary: Guard the `VERBS[args.verb]` lookup in `src/cli/main.ts` with `Object.hasOwn`.
  evidence: `factory constructor` resolves to `Object`, prints its args and exits 0; `factory __proto__` prints a TypeError stack. Pre-existing from 1-1.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/1-4-brownfield-front-half-of-the-pipeline.md`
  summary: Cap agent reissues (parse failures and stopped-agent orphans) and raise a `Non-convergence` escalation card instead of reissuing forever.
  evidence: `done.ts`, `next.ts` `stepEvents` and `steps.ts` `reissueEvent` reissue with `attempt+1` unconditionally, so an agent that keeps writing bad output loops forever, each loop costing a spawn. 1-4's spec settles neither a cap nor the card; AD-24's overdue reissue-once-then-ask_human is the model.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/1-4-brownfield-front-half-of-the-pipeline.md`
  summary: Check whether a test or health command whose grandchildren keep stdout/stderr open defeats `factory check`'s `spawnSync` timeout (unverified, medium if true).
  evidence: `check.ts` `sh()` kills only `sh` on timeout. Settle it with a check command that backgrounds a long `sleep` inheriting stdout, run with a short timeout. If it hangs, spawn detached with output to a file and kill the process group.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/1-5-build-review-wrap-and-record.md`
  summary: Check whether `SendMessage` can always resume a finished builder, and if it can fail, reissue a failed `resume` step as a `spawn` instead of looping (unverified, medium if true).
  evidence: `step_reissued` copies the old step's kind, so a `resume` whose agent is gone is reissued as another `resume` of the same `agent_id`. SKILL.md gives the conductor no fallback. Settle by resuming a finished builder in a real `claude --plugin-dir .` session.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/1-5-build-review-wrap-and-record.md`
  summary: Decide whether the human-approved final `--no-ff` merge should skip the target repo's hooks or use a message those hooks accept (unverified, medium if true).
  evidence: `mergeRun` runs the user's commit-msg and pre-merge-commit hooks, so a commitlint hook that rejects `factory: merge …` makes every merge fail. The card still offers the merge, but no retry can pass. Settle with a husky + commitlint brownfield repo.

- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/2-1-dashboard-server-and-projection.md`
  summary: Give the dashboard's static-file traversal guard (`isUnder` in `src/dashboard/server/http.ts`) a real test once `dashboard/dist` exists, and drop or rewrite the misleading `%2e%2e` assertion in `test/dashboard.test.ts`.
  evidence: With no `dashboard/dist`, every non-SPA path gets its 404 from the placeholder branch before the guard runs. `URL` also normalizes `%2e%2e` segments, so removing the guard fails no test. Story 2-2 adds the dist.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/2-2-dashboard-board-ui.md`
  summary: Build the AD-16 fallback: when `dashboard/dist` is missing, build the board into the plugin data directory (never under `${CLAUDE_PLUGIN_ROOT}`) and serve it from there.
  evidence: 2-2 commits `dashboard/dist`, so the server finds a build and the fallback is never exercised. Without dist, `src/dashboard/server/http.ts` still serves its placeholder page at `/` and `/replay/<name>`. The fallback needs the web package's dev deps at runtime (or a vendored build step), plus a data-dir path in `store/paths.ts` that the server checks before the placeholder.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/2-2-dashboard-board-ui.md`
  summary: Test the dashboard server's no-dist placeholder branch (`/` and `/replay/<name>` serve the placeholder; other paths 404) once a dist-dir override exists.
  evidence: 2-2 replaced the only placeholder assertions with dist assertions; with `dashboard/dist` committed and `dashboardDistDir()` fixed relative to the module, no test reaches `!existsSync(index)` in `src/dashboard/server/http.ts`. The AD-16 fallback-build entry above will need the same override.

- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/3-3-full-slice-plan-and-reviewer-roster.md`
  summary: Move SliceCard's `reviewing` derivation into `lib/model.ts` next to `pendingReviewers` and test that an IN_REVIEW card with pending roster rows shows no generic "reviewers reviewing…" row.
  evidence: The `|| pending.length` rule lives inline in `SliceCard.svelte:23`; the repo has no Svelte component tests, so dropping it leaves the suite green (3-3 review, V6).
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/3-4-full-build-loop-and-escalations.md`
  summary: Assert end to end that a Non-convergence card's `accept also accepts new dependencies` list holds only that slice's own dependency files.
  evidence: The pipeline Non-convergence assertion is an unanchored regex, and only `cards.test` checks the suffix. Reverting `next.ts` to the base_sha diff would offer the human another slice's accepted `package.json` change again, and no test would fail (3-4 review, V8).
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/4-1-replay-engine-for-single-run-recordings.md`
  summary: Make a real interactive increment 1–3 recording (never `claude -p`) and add it to `test/fixtures/recordings/` with its `buildTimeline` snapshot as a regression fixture.
  evidence: 4-1 ships synthetic fixture recordings only (decided 2026-10-25); no real recording existed under `~/.factory/recordings/` when it was planned.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/4-1-replay-engine-for-single-run-recordings.md`
  summary: Test the replay wiring in `App.svelte`: the board clock is `playback.t`, Needs You announcements are suppressed at 16× with one summary when it stops, and a drawer whose source is gone after a seek closes with focus on the timeline.
  evidence: These live only in the component, and the repo has no Svelte component-test harness. Swapping the clock to `stream.now` or deleting the 16× suppression leaves the suite green (4-1 review, row 19). The pure helpers (`needsSummary`, `selectionPresent`, `replayShortcut`) are tested.
