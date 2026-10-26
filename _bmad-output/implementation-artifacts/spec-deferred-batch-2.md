---
title: 'Clear deferred batch 2'
type: 'chore'
created: '2026-10-26'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `deferred-work.md` holds open entries (verified 2026-10-26) whose decisions the party already made. These cover check timeouts that pass, briefs that drop the intake scope, a Bash-only sandbox tripwire, a merge message that commitlint rejects, prompts consumed as forged too early, untested dashboard replay wiring, drawer focus loss, piling worktrees, and three doc decisions.

**Approach:** One commit per group on main (`fix(factory): …` / `test: …` / `docs: …`), each with its tests. Before every commit the full node:test suite and the dashboard build must be green. Decisions are not reopened.
1. **Checks** (`src/cli/check.ts` `sh()`). A timeout (`r.error?.code === 'ETIMEDOUT'` or `r.signal`) gives code 124 and a log saying "timed out". The command is spawned `detached: true`, and on timeout `process.kill(-r.pid, 'SIGKILL')` runs in try/catch. Tests: `sleep 8 & echo started` with a 500 ms timeout returns 124; after `sleep 7.77 & echo $!`, the printed pid is dead.
2. **Briefs** (`src/cli/brief.ts`). The spec-writer, designer, slicer and builder briefs carry the intake task (`state.intake.task`, falling back to `state.task`) plus its in-scope and out-of-scope items. Tested with a fixture run.
3. **Guard** (`src/hooks/guard.ts`, `hooks/hooks.json`). `dangerouslyDisableSandbox === true` is denied on any tool, in both `decide()` and the early check in `guard()`. The PreToolUse matcher also covers Monitor and PowerShell. Before binding (`boundRun()` null), if `readInbox(session)` holds an unconsumed /factory prompt, the guard denies only the sandbox flag. Tests: a bound session, an unbound session with a pending prompt, and an unbound session without one (left untouched).
4. **Merge message** (`src/cli/next.ts` mergeApproved). The message is `Merge branch 'factory/<run>'` with the task in the body. Hooks stay on and `--no-verify` is never passed. Test: a temp repo whose commit-msg hook accepts only conventional commits or `/^Merge branch .*/` lets the merge succeed. A hook that rejects everything puts its stderr in the failure output.
5. **Prompt consumption** (`src/cli/prompt.ts` `newestPrompt`). A newest group missing `human` or `text` stays pending and throws NO_HUMAN_PROMPT without superseding anything; a newer complete group supersedes it. A complete group that fails `matchTurn` gets one transcript re-read after ≤500 ms before it is consumed as forged. Tests for both.
6. **Dashboard.** In `lib/drawer.ts`, a claim chip or artifact button inside the drawer carries the drawer's original opener forward, so `closeDrawer` returns focus there; the store logic is tested. The replay wiring moves out of `App.svelte` into pure `lib/` helpers tested with node:test: the clock is `playback.t` in replay; Needs You announcements are muted at 16× with one summary when it stops; and after a seek, a drawer whose source is gone closes with focus on the timeline. Swapping the clock to `stream.now` must fail a test. No new dev dependencies.
7. **`factory prune`** (new, read-only). It lists run worktrees under `<repo>/.claude/worktrees` whose runs are MERGED (or COMPLETED) or ABANDONED, plus prunable ones from `git worktree list`. It prints the exact `git worktree remove` / `git worktree prune` / `git branch -D` commands for the human's own terminal and never runs them. README line.
8. **Docs.** AD-16's dist fallback is dropped: add a test that fails without `dashboard/dist/index.html`, and a spine Overrides line. The 5-1 shared-service window is accepted as a known limit in the spine: start refuses while the claim is held, so the only gap is two runs started at the same moment on a shared DB. SPEC 7-1 wording (approved by d2t): CAP-10 becomes "no command in a factory session runs outside the sandbox", and the Constraints bullet says setup configures the sandbox except `allowLocalBinding`, which is manual. Note the pre-bind guard in AD-31.
9. **deferred-work.md.** Remove every entry this batch closes, plus the "git worktree remove under the sandbox" entry (obsolete since ed681e0). Keep these, each tagged "dry run 3": the real interactive recording fixture, ExitWorktree after /clear, the merge on a husky+commitlint brownfield repo, Jest/ESLint crawling kept worktrees, and the spike 02 rerun (optional). New findings are logged there, not fixed.

</frozen-after-approval>

## Implementation Notes

- Investigation pointers: `sh()` is at check.ts:36 and is not exported yet; export it for the test. briefText is at brief.ts:251. The intake shape (`Intake.task`, `scope.{in,out}`) is in core/events.ts:76, and cards.ts:49 shows the `list` join style. guard.ts: `decide` is at 173 and `guard` at 190; `readInbox`/`isConsumed` are in store/sessions.ts. The merge message is at next.ts:434, and the integrate merge at next.ts:115 keeps its own `--no-verify` (an internal run-branch merge, not the human's). The pipeline tests at 1344 and 2917 assert the old `factory: merge` subject. Dashboard: `openDrawer` callers are ClaimChip (used inside Drawer.svelte:159) and ArtifactButton (`tone="drawer"` inside the drawer). Web store tests import by path and skip without `src/dashboard/web/node_modules` (see test/web-stream.test.ts). VERBS is in cli/main.ts; `worktreePath`/`worktreesDir` are in store/paths.ts; terminal phases are in core/reducer.ts:8.
- Group 1: `sh()` is exported and spawns `detached: true`. On ETIMEDOUT or any signal, it SIGKILLs `-pid` (try/catch) and returns 124 with "timed out after N ms". Tests in `test/cli.test.ts`. SIGKILL lands asynchronously, so the dead-pid test polls for up to 2 s. Mutation checks: dropping the kill fails the pid test, and dropping the 124 fails both.
- Group 2: `taskFacts` in `brief.ts` handles spec-writer/designer/slicer/builder. It writes `task (agreed at intake)`, `in scope`, and `out of scope (do none of it)`, redacted. A run without an intake keeps `task: <start task>`. The fixture-run test in `test/pipeline.test.ts` covers all four roles (the designer through `briefText` over the run's state).
- Group 3: `decide()` denies the flag first, on any tool. `guard()` denies it when bound or when `readInbox` has an unconsumed group, and does nothing else unbound. The matcher adds Monitor|PowerShell. Tests: `test/guard.test.ts` (decide) and `test/hooks.test.ts` (bound, unbound with a pending prompt, unbound without). Mutation check: dropping the pending-prompt branch fails the pre-bind test.
- Group 4: `mergeMessage(branch, task)` is in `git.ts`, and `mergeApproved` passes it the intake task (falling back to the start task). The integrate merge at next.ts:115 keeps its own `--no-verify` (it is internal to the run branch). Tests in `test/worktree.test.ts` use a temp repo with a commitlint-like commit-msg hook (the old subject is rejected, the new one passes) and a reject-all hook (its stderr is in `error`, and the merge is aborted). The two pipeline assertions on the old subject are updated.
- Group 5: `newestPrompt(session, wait)`. An incomplete newest group throws NO_HUMAN_PROMPT and consumes nothing. A complete group that fails gets one `wait(TRANSCRIPT_REREAD_MS = 250)` and a re-locate/re-read. Tests in `test/driver.test.ts`, the re-read one in-process with an injected wait.
- Group 6: `openDrawer(sel, { inDrawer })` carries `opener`, and `closeDrawer` focuses `returnFocusTo(sel)`. ClaimChip takes `inDrawer` (Drawer.svelte sets it), and ArtifactButton uses `tone === 'drawer'`; `openPin` passes it too. The new `lib/board.ts` holds `boardSources`, `boardClock`, `needsAnnouncer` and `followBoard`, and App.svelte only wires them. Tests are in `test/web-board.test.ts` (skipped without web node_modules, like the other store tests). Mutation checks: swapping the replay clock to `stream.now` and deleting the 16× mute each fail a test. dist is rebuilt.
- Group 7: `src/cli/prune.ts` registers verb `prune` with no `--session`. It walks `factory-*` dirs and reads each run's phase. It lists MERGED/COMPLETED/ABANDONED with `git -C <root> worktree remove --force`, adds `worktree prune` when `git worktree list --porcelain` shows prunable entries, then `branch -D`. Other dirs are listed under `kept` with the reason. Tested in `test/pipeline.test.ts`. README line under "Reset after a run".
- Group 8: spine AD-15 known limit, AD-19 (no fallback), AD-13/AD-31 (pre-bind guard, matcher), plus an Overrides row. SPEC CAP-10 success and the Constraints bullet. `test/web-build.test.ts` fails without `dashboard/dist/index.html` or the assets it names.
- Suite: the full `node --test test/*.test.ts` takes about 12 min and binds local ports, so it runs outside the sandbox. HEAD passed 427/427 before the batch. Output from the long pipeline file arrives in bursts, so a quiet log is not a hang.
- Choices: `factory prune` needs no `--session`, since it is read-only and run by the human like `setup`. The remove command uses `--force` because kept worktrees hold untracked installs and copied gitignored files.

## Review Triage Log

- Group 9 not done and nothing committed: false at review time. The review ran on the uncommitted groups 1–8 by design, so its patches fold into each group's commit; group 9 lands last.
- `sh()` labels a non-timeout signal (maxBuffer ENOBUFS, a self-kill) as "timed out": low, real, caused by this change. Patched: code 124 for any signal stays (decided); the log now adds the signal and any non-ETIMEDOUT error message.
- `sh()` comment overclaims ("no grandchild outlives"): low, real. Patched: the comment now says only a grandchild that holds the output is killed, on timeout.
- An incomplete newest prompt has no age limit, and an unbound session with a pending prompt keeps the flag deny: rejected. Both are the party's decision (a newer complete group supersedes it; the deny before binding is only the sandbox flag).
- AD-13 still says unbound sessions get no output: low, real. Patched: AD-13 names the guard's pre-bind deny as an exception.
- AD-31 claims any flag-taking tool is covered while the matcher lists three: low, real. Patched: the wording now says the matcher routes Bash, Monitor, PowerShell and the write tools, and a new tool is added to it.
- `openPin` in Drawer.svelte opens without `inDrawer`, so the original opener is lost after a pin: medium, real, same bug class this batch fixes. Patched, and dist rebuilt.
- ArtifactButton infers in-drawer from `tone="drawer"` while ClaimChip takes a prop: low, style. Rejected: every in-drawer ArtifactButton already passes `tone="drawer"`.
- prune counts MERGED as over, uses `-D` instead of `-d`, misses branches whose worktree dir is gone, gives no per-path reason for prunable entries: rejected. MERGED and `-D` are the decision, and the rest are low and rare.
- prune output is JSON, so a quoted path's `'\''` escapes when copied: low. Rejected: all verbs print JSON; paths under `.claude/worktrees/factory-<run-id>` never need quoting.
- A corrupt `commands.jsonl` would abort the whole prune listing: low, real. Patched: that run is listed as kept, with the read error.
- Prune tests miss MERGED/COMPLETED and quoting: low. Rejected: the phase test is one list check, and the abandoned run covers the path through it.
- Scoped briefs say "agreed at intake" with no intake, and intake text is not redacted: low, real. Patched: no recorded intake (or no intake task) falls back to `task:`, and the scoped facts are redacted with the run's values; both are tested.
- SPEC constraint still says worktrees live under `~/.factory`: false for this change. It predates it, and the spine's Overrides table already overrides it (AD-15).
- The dist test passes vacuously if `base` turns relative: low, real. Patched: it asserts at least one asset reference.
- The clock-swap test lives behind the svelte SKIP and doesn't cover App.svelte binding `stream.now` directly: rejected. Every web store test uses the same SKIP, and App now gets its stores only from `boardSources`.
- `needs.fast` re-runs on every lanes update: false. That is the original effect's behaviour (it read `$lanes` too), and `wasFast` keeps a single summary.
