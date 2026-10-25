---
title: 'Build, review, wrap, and record'
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After `/factory approve gate2` the run sits in BUILD forever: `due()` has no BUILD or WRAP case, no builder or reviewer agent exists, nothing commits, nothing merges, and `factory record` does not exist. So the walking skeleton cannot be demoed end to end.

**Decisions (human, 2026-10-24):** a local `--no-ff` merge into the main checkout's current branch (no PR path); clean integration of a moved target only, with conflicts resolved by the human; `git.deps` is enforced at slice close; the full spec is kept as one story.

**Approach:** Add the single-slice build loop (builder → CLI commit → `contract.test` → reviewer-code → resume on findings, at most `MAX_RETRIGGER_ROUNDS`) and close `S1`. Then add WRAP: health + test + baseline, a `merge` card, a local merge only after `/factory merge`, and housekeeping. Finish with `factory record` writing a redacted recording. Add `agents/{builder,reviewer-code}.md` and extend the conductor skill.

## Boundaries & Constraints

**Always:** Node built-ins only. AD-2 layering. Every new `events.ts`/state field is optional and additive, and the three fixture snapshots stay byte-identical. Paths come only from `paths.ts`. All git runs in the CLI, unlocked, and appends with `basis_seq` (AD-8, AD-29). The builder never commits. At each builder `done` whose output parses, the CLI commits the worktree as `factory: S1 <title> (<step_id>)` and records the `sha` on `step_reported` (AD-30). `redact()` applies to every embedded projection and to every recorded line. The main checkout changes only through the human-approved merge.

**Never:** No multi-slice pipelining, roster, or other reviewers (3-3/3-4). No budget clock or cut (3-1). No `rerun` (3-x). No reissue cap or overdue reissue. No dashboard or replay (2-x/4-1). No branch deletion. No `gh` PR path and no builder-resolved merge conflicts (deferred to 3-4).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Build | BUILD, `S1` BACKLOG | `next` appends `slice_started{S1}` and issues `spawn d2t-factory:builder`. The brief lists the pinned spec, `S1.acs`, `S1.notes`, the run contract and the worktree | Builder `ESCALATE` → `ask_raised` with the slice → ESCALATED; `rule E<n> retry <note>` resumes it |
| Commit | Builder `done`, output parses | CLI runs `git add -A` + commit in the worktree, and `step_reported{sha}`. An empty diff still commits (`--allow-empty`) | Parse error → no commit, MISSING_EVIDENCE + reissue (1-4 rule) |
| Slice test | Builder verified (slice IN_REVIEW) | `run_check contract.test`, pinned to that sha | Fail → builder round with the test log in its brief |
| Review | Test passed at the builder's sha | `spawn d2t-factory:reviewer-code`. The brief gives `git diff <base_sha>..<sha>`, the spec, `S1.acs` and the charter. `step_verified{verdict}` | `FINDINGS` with no finding block, or `APPROVE` with one → parse error |
| Round | `FINDINGS`, or a failing slice test, and `rounds < MAX_RETRIGGER_ROUNDS` | Builder `resume` (same `agent_id`, if spawned under the current `session_bound`), else `spawn` with a rework brief. The new brief + `output_path` cite the findings or test log. `rounds += 1` | At the cap → `ask_raised` `Non-convergence` card: `rule E<n> retry <note…>` (one more round), `rule E<n> accept` (close the slice), `abandon` |
| New dependency | Before close: inline `git.deps` diffs manifests and lockfiles (`package.json`, `*lock*`, `requirements*.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile*`) between `base_sha` and the slice sha | Any change → `ask_raised` `New dependency: <files>` card with `rule E<n> accept` (close proceeds) / `rule E<n> retry <note…>` (builder round) / `abandon` | — |
| Close | Reviewer `APPROVE`, and a passing `contract.test` at a sha containing the last builder commit, with no builder claimed | `slice_closed{S1, check_id}` → `stage_completed{BUILD}` → WRAP | — |
| Integrate | WRAP entered, main checkout's current branch head ≠ `base_sha` | CLI merges that head into the run branch in the worktree (clean only, committed by the CLI), and the WRAP checks run at the new head | Conflict → `git merge --abort`; the merge card shows the conflicting files and offers only `rework S1`/`abandon`. Once the human commits a resolution on the run branch, the next `factory next` sees a head that contains the target, re-runs the WRAP checks and re-raises the card |
| Wrap | WRAP entered | `run_check contract.health` and `contract.test` at the branch head, plus an inline `git.baseline`. Then the `merge` card: the slice, the sha, diffstat, the test result, the reviewer verdict, rounds | A failing check or baseline → the card shows the reason and offers only `rework S1`/`abandon` |
| Merge | Open merge card; `/factory merge` | `decide` verifies the card's evidence is fresh at the branch head, appends `merge_approved{pins}`, runs `git merge --no-ff factory/<run-id>` in the main checkout's current branch, then appends `check_ran git.merged` + `merged{sha}` | Main checkout ≠ baseline, detached HEAD, or target moved → refused with the reason, prompt consumed, card stays |
| Rework S1 | Open merge card; `/factory rework S1 <note…>` | `rework_requested{target:'S1', voids}` voids `slice_closed` and the WRAP checks; the run returns to BUILD; the builder gets the note. This round doesn't count (AD-33) | Elsewhere → ILLEGAL_TRANSITION |
| Housekeeping | `merged` | `next` issues `exit_worktree` (verified by the next CLI call from outside). Then the CLI stops the dev server, runs `git worktree remove`, releases the port, appends `run_completed`, and writes the WRAP recording named `<run-id>` | Worktree removal fails → reported in `next`'s output; the run still completes |
| Record | `factory record <name> [--runs id,…]` | Writes `recordings/<name>/manifest.json`, `runs/<repo-hash>/<run-id>/…` (commands, facts, artifacts; no `redact.json`, lock or devserver files) and `transcripts/<session>[-<agent>].jsonl` for every session bound to the run, each line redacted | Name exists → `CLAIM_TAKEN` |

</frozen-after-approval>

## Code Map

- `src/core/schedule.ts` `due()` -- no BUILD/WRAP case today (`schedule.test.ts:47` asserts `[]` for BUILD…ABANDONED; update that test). Add `build(s)` and `wrap(s, ctx)`. ctx gains `in_worktree` reuse for `exit_worktree`. Keep `agent()`/`runCheck()` helpers.
- `src/core/reducer.ts` -- slice transitions already exist but are unused: `slice_started` (`:249`), builder `step_verified` → IN_REVIEW (`:215`), reviewer `step_verified{verdict:'FINDINGS'}` → FINDINGS_QUEUED (`:216`), builder `resume` issued → BUILDING + `rounds+1` (`:174`), `slice_closed` (`:252`), BUILD→WRAP (`:152`), `merge_approved`/`merged`/`run_completed` (`:342`, `:255`, `:262`), `rework S<n>` BUILD-only (`:297`). Add only: a `resume` from IN_REVIEW (test failure) also counts as a round, `rework S<n>` in WRAP before `merged` returns the phase to BUILD, and `exit_worktree` steps. One open step per role (`:170`) holds.
- `src/core/events.ts` -- additive: `STEP_KINDS += 'exit_worktree'`; `merged.target?`; `step_reported.output` for findings. Implement the `git.merged` runner (`check.ts:106` throws BAD_ARGS for it today).
- `src/core/verify.ts` `agentEvidence` -- a resumed step reuses `agent_id`, so a `subagent_stopped` counts only if its `ts` ≥ the step's claim ts. Otherwise round 1's stop verifies round 2. Add merge evidence (open merge ask + passing health/test at the branch head + baseline).
- `src/core/{output,artifacts}.ts` -- parse ` ```finding ` blocks (AD-11 order: category, location, failure_scenario) and enforce the charter categories. `checkOutput` already requires VERDICT for `reviewer-*`. Add the builder schema (`summary`).
- `src/core/cards.ts` -- add `mergeCard` (type `merge`) and `nonConvergenceCard`. `escalationCard` exists.
- `src/cli/decide.ts` -- `:67` refuses slice rework ("lands in 1-5"); allow `S1` at an open merge card. `merge_approved` currently falls to the default (`:94`): give it the card check and the merge. Rule choices for Non-convergence.
- `src/cli/next.ts:175` -- sets `output_path` only for spawn/run_check and writes a brief only for spawn. A `resume` needs both. `stepEvents`/`prepare` add the post-done commit, slice close, WRAP entry and housekeeping.
- `src/cli/done.ts` / `steps.ts` `reportEvents` -- commit for builder steps; set `step_verified.verdict` from the parsed VERDICT (never set today).
- `src/cli/brief.ts` -- add `FORMAT` + `inputs()` for builder and reviewer-code; carry findings/test-log/rework notes.
- `src/cli/git.ts` -- add `commitAll`, `diffStat`, `currentBranch`, `mergeInto`, `worktreeRemove`. If the repo has no user identity, use `-c user.name=d2t-factory -c user.email=factory@localhost`.
- `src/cli/record.ts` (new) + `main.ts` verb -- reuse `prompt.ts` `locateTranscript` for session transcripts (agent transcripts: `agent_transcript_path` from facts, realpath under `~/.claude/projects/`); `paths.ts` `recordingsDir()` exists, unused; `loadRun`/`readRedactValues` from store; `plugin_version` from `.claude-plugin/plugin.json`.
- `src/core/stop.ts` -- already handles builder `resume`; `exit_worktree` must block stop like `enter_worktree`.
- `skills/factory/SKILL.md:24-34` -- documents spawn/run_check/enter_worktree/ask_human and forbids resume. Add `resume` (SendMessage to `agent_id` with the brief path) and `exit_worktree` (ExitWorktree, keep).
- `test/harness.ts`, `test/pipeline.test.ts` -- reuse `conductor()`, `toSpec`, `agentWrites`, `agentStops`; add a `toBuild` helper. `:370` expects `rework S1` to fail with /1-5/; update it. Fixtures: don't regenerate.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/{schedule,reducer,events,verify,output,artifacts,cards,stop}.ts` -- per the Code Map.
- [x] `src/cli/{next,done,steps,decide,brief,check,git,record,main}.ts` -- the build loop, commits, WRAP, merge, housekeeping, and the `record` verb.
- [x] `agents/builder.md` (opus; Read, Grep, Glob, Edit, Write, Bash; edits only the worktree; installs only via the contract's `add`; never commits or starts servers) and `agents/reviewer-code.md` (sonnet; Read, Grep, Glob, Bash read-only; the AD-11 charter; writes only `output_path`).
- [x] `skills/factory/SKILL.md` -- resume and exit_worktree; the merge card printed verbatim.
- [x] `test/{schedule,verify,output,cards,record}.test.ts` units + `test/pipeline.test.ts` end-to-end, one per matrix row, on a temp git repo.

**Acceptance Criteria:**
- Given a run at BUILD (1-4's sequence), when the full sequence runs through `bin/factory` with hook-format facts (builder → test → reviewer FINDINGS → builder resume → test → reviewer APPROVE → close → WRAP checks → `/factory merge` → exit_worktree), then the run is COMPLETED, the main checkout's branch holds the builder's change, the worktree is gone, the port is released, the recording exists and contains no `SECRET`, and every command passes `validateEvent`.
- Given the repo, when Verification runs, then all tests pass, tsc reports 0 errors, and the fixture shasums are unchanged.

## Implementation Notes

- Reducer: a builder step issued while S1 is FINDINGS_QUEUED or IN_REVIEW counts a round for `spawn` as well as `resume`. The spawn fallback (agent not spawned under the current `session_bound`) would otherwise leave the slice stuck in FINDINGS_QUEUED. Fixtures are unaffected.
- Builder ESCALATE → `rule E<n> retry` reissues the escalated step with the note (the reducer copies its kind), and the slice goes back to BUILDING. "Resumes it" is read as resuming the slice; a spawned builder's retry is a fresh spawn.
- `git.deps` matches manifests by basename; `*lock*` excludes source files (`clock.js`).
- `reviewer-code` has the Write tool, since `output_written` evidence only comes from Write/Edit.
- The per-step commit uses `--no-verify` (the factory's own branch); the merges run the repo's hooks.
- WRAP `contract.health` restarts the dev server so it judges the branch head. Card prose is redacted; commands and pinned shas are not.
- Merge cards carry optional `sha`/`target` (what their evidence is pinned to). A stale open card is closed by `next` (`step_verified{evidence:['superseded:…']}`) before a fresh one is raised.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-24): blind-hunter (B), edge-case-hunter (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| V1/B3/E6 | After a failed final `git merge`, or a WRAP baseline mismatch the human later fixes, the merge card never offers the merge again | high | `schedule.ts:121-123`: a failing `git.merged` re-raises the card with "the last git merge failed" and no `/factory merge`. With head and target unchanged nothing re-probes, so the only exits are rework and abandon. The Merge row says the card stays. The merge-failure path is untested end to end | patch: after a failed merge the card still offers merge with the failure in its reason; a baseline-blocked card refreshes once the digest matches; e2e test |
| B4 | The merge card's diffstat counts the target's own commits after integration | medium | `next.ts:98` `diffStat(wt, base_sha, tip)` runs after the target has been merged into the run branch, so the card shows main's changes as the run's | patch: `target...tip` |
| B7 | `rule E<n> accept` on Non-convergence closes the slice without the dependency gate | medium | `decide.ts` sets `slice_to: 'CLOSED'`, so `buildEvents`' `git.deps` never runs. The New dependency row says git.deps runs before close | patch: the Non-convergence card names the changed dependency files and says accept accepts them |
| B9/E9/V2 | `isDependencyFile` misses go.sum, pom.xml, build.gradle, composer.json, Pipfile, setup.py, *.csproj… and flags block.json, clock.svg; untested | medium | `next.ts` `MANIFEST_RE` plus the `/lock/i` heuristic; no test calls it | patch: an explicit name list + table test |
| B10/E14 | WRAP health restarts the dev server while WRAP `contract.test` may be using it | medium | `wrap()` issues both checks at once and the conductor runs both in the background; `healthCheck(restart=true)` kills the server | patch: test only after health is verified |
| E7 | The WRAP integrate merge runs the repo's commit-msg/pre-merge hooks, so a commitlint hook blocks integration forever | medium | `mergeInto` has no `--no-verify`; `commitAll` has it. A husky commitlint rejects `factory: integrate …` | patch: `--no-verify` on the integrate merge (the final merge: see defer) |
| E16 | `record --runs a,b` with one session bound to both runs redacts that transcript with only the first run's values | medium | `record.ts:943-946` copies the transcript inside the first run's loop, using `values` of that run | patch: union of all recorded runs' redact values |
| B12/E17 | The recording copies any file with a NUL byte unredacted, and follows symlinks under artifacts | low | `copyRedacted` `buf.includes(0)`; `copyTree` `statSync`. The fix is a direct replacement | patch: binary only for image extensions; skip symlinks |
| B1/E1 | `mergeRun` merges the branch ref, not the approved sha | low | `mergeInto(c.root, branch, …)` after the lock; a commit landing on the run branch between approval and merge would be merged unapproved. The fix is a direct correction | patch: merge `merge_approved.data.sha` |
| E5 | On `next`'s last round (`integrate=false`) an unintegrated head gets no problem, so checks/card are issued for it | low | `wrapProbe` pushes no problem when `!integrate`; one-line fix | patch |
| B17 | The reviewer brief's format example nests ```` ```finding ```` inside a ```` ``` ```` fence | low | `brief.ts` `FORMAT['reviewer-code']`; the inner fence closes the outer one | patch: four-backtick outer fence |
| B13 | SKILL.md mentions `worktree_error` but not `recording_error` | low | `recordRun` returns `recording_error`; direct text fix. Persisting housekeeping results is not asked for (the spec says "reported in next's output") | patch (text only) |
| V3 | The merge-time pin refusal ("changed since it was verified") is untested | medium (pre-verified) | Only gate 1's pin path is tested | patch: test |
| V4 | `wrapProbe`'s merge-in-progress guard is untested; without it `next` would `merge --abort` the human's half-done resolution | medium (pre-verified) | No `next` call runs while `MERGE_HEAD` exists | patch: test |
| V5 | The WRAP dev-server restart is asserted only in a `SERVER` test that skips under a sandbox | medium (pre-verified) | `assert.notEqual(pidOf(), scaffoldPid)` in the acceptance test only | patch: test without port binding |
| V6 | `factory record --runs` is untested | medium (pre-verified) | Tests call `writeRecording` or `record <name>` only | patch: test |
| V7 | The fallback commit identity is never exercised, since the developer's global git config supplies one | medium (pre-verified) | `bin/factory` inherits `process.env`; `identity()` returning `[]` keeps the suite green | patch: isolate the global git config in the harness |
| B14 | No fallback if `SendMessage` cannot resume the builder; a `resume` reissue copies its kind, so it could loop | maybe-false (medium if true) | Settle by resuming a finished builder via SendMessage in a real `claude --plugin-dir .` session; if it can fail, reissue a resume as a spawn | defer |
| E7b | The final `--no-ff` merge into the user's branch runs their hooks; a commit-msg hook rejecting `factory: merge …` makes every merge fail | maybe-false (medium if true) | Policy question: skip hooks on the human-approved merge, or let the human set the message. Settle with a husky + commitlint repo | defer |
| B5/E10 | The reviewer diff `base_sha..sha` includes earlier slices, or main after a WRAP rework | low | Single slice in 1-5 (multi-slice is 3-3/3-4); the rework case needs a moved target plus a rework at the card | reject |
| B6/E8 | `git.deps` diffs from `base_sha`, so later slices or a post-integration rework re-raise New dependency | low | Same as B5: single slice; `accept` clears it | reject |
| B2/E2 | A crash or abandon between `merge_approved` and `merged` leaves main merged and the run in WRAP | low | A sub-second window during a local merge; same class as 1-4's crash-window rejects | reject |
| E3 | `merge` ok but the `git.merged` ancestor check fails | false | The merge just made the run head an ancestor of HEAD; only a concurrent rewrite of main could break it | reject |
| B8/E11/E12 | Builder commits made outside the lock can be duplicated, or lost to a reissue, or throw on `index.lock` | low | A sha is dropped only when the step was reissued meanwhile (`done.ts:50`, `o !== out`), so no live step lacks it; a duplicate needs lock contention; an extra empty commit is harmless | reject |
| B11/E19 | Only the newest reviewer and the spec are pinned at merge | false | One slice in 1-5; the spec projection always carries `sha256` | reject |
| B15 | Nothing scans the diff for secrets before commit/merge | low | Threat model is a wrong LLM (AD-31); needs the builder to paste a `.env` value into a tracked file | reject |
| B16 | Agents' test runs leave untracked files that are swept into commits or block `worktree remove` | low | Generated files are normally gitignored; a failed removal is reported by design | reject |
| E4 | A secret in `state.task` lands in commit messages | low | The task is typed by the human; redact values come from copied gitignored files | reject |
| E13 | A worktree deleted during WRAP stalls the run | low | Needs a human deleting the worktree mid-run (1-4 E14) | reject |
| E15 | `rework S1` while WRAP checks still run reissues voided checks into BUILD | false | The merge card, the only place rework S1 is legal, is raised only after both WRAP checks are verified | reject |
| E18 | A retried housekeeping round reports `devserver_stopped: false` | low | Needs lock contention; the outcome is unchanged | reject |
| E20 | reviewer-code has an unrestricted Write | low | Recorded deviation: output evidence needs Write; the agent is told to write only `output_path` | reject |

## Design Notes

Per round the order is builder → commit → test → reviewer, so the reviewer only ever sees code whose tests pass. The test that passed at the builder's sha is also the slice-close evidence, as long as no new builder commit follows (AD-30). Merge evidence is pinned to the branch head sha: any commit after the card voids it. The recording runs after `run_completed`, so a replay ends COMPLETED.

## Verification

**Commands:**
- `node --test test/` -- expected: all pass.
- `npm i --prefix "$TMPDIR/tsc" --cache "$TMPDIR/npm-cache" typescript@7.0.2 @types/node@22 && "$TMPDIR/tsc/node_modules/.bin/tsc" -p tsconfig.json --typeRoots "$TMPDIR/tsc/node_modules/@types"` -- expected: exit 0.
- `shasum test/fixtures/*.state.json` before/after -- expected: identical.

**Manual checks (if no CLI):**
- In `claude --plugin-dir .` on a small real brownfield repo: `/factory add a footer` reaches a merged change and a recording under `~/.factory/recordings/`.
