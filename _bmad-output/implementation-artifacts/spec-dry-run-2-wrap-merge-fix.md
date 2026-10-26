---
title: 'Dry run 2 fixes: WRAP merge order, retry, error text (3, 4, 4b)'
type: 'bugfix'
created: '2026-10-26'
status: 'done'
baseline_commit: 'f6c968273aa06e3d14bbcc5cab037085cf522d55'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/dry-run-2-findings.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** (3) `/factory merge` runs `git merge` while the conductor session is still in the worktree, so the sandbox blocks writes to the main checkout and the merge aborts. (4) The merge card is verified before the merge runs, and `decide` throws CHECK_FAILED, so the conductor ends its turn and the run sits in WRAP with no open card. (4b) `check_ran git.merged` keeps only the exit code.

**Approach:** `decide` records `merge_approved` and no longer merges. While that approval is pending, `next` issues `exit_worktree`. Once the conductor is outside the worktree, `next` runs the merge and records `check_ran git.merged` (with git's redacted error on failure). Success goes on to `merged`, worktree removal and `run_completed`. A failure reopens the merge card with git's error in the reason, and `/factory merge` retries. Decisions made by the human (don't re-open): exit before merge; the CLI still removes the worktree after success; no sandbox bypass and no new allowWrite rule; only a successful merge spends the approval; error text goes into `check_ran`.

## Boundaries & Constraints

**Always:** Event schema stays `v:1`, additive only (`check_ran.data.error?: string`). Every committed fixture and recording folds byte-identical (old logs: `merged` then `exit_worktree`, still accepted). Error text is redacted with the run's redact values. Update pipeline-stages.md, ARCHITECTURE-SPINE ADs (AD-7 table, AD-8 Merge, AD-15, AD-35, state diagram), the `setup.ts:47` comment and the conductor skill in the same change.

**Never:** `dangerouslyDisableSandbox`, a new sandbox rule in `factory setup`, an automatic re-merge without a fresh `/factory merge`, or merging while the session is still inside the worktree.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Happy path | `/factory merge` from inside the worktree | decide → `{decision, phase: WRAP}`; next → `exit_worktree`; done from main → next merges → `merged`, worktree removed, `run_completed`, `done: true` |
| Already outside | approval while cwd is the main checkout | no `exit_worktree`; next merges at once |
| Merge fails | git error (hook, sandbox, conflict) | `check_ran git.merged exit 1, error: <redacted git text>`; phase stays WRAP; a fresh merge card whose reason ends `the last git merge failed and was aborted: <error, one line>`; `/factory merge` is accepted again |
| Main moved off the approved branch, or its status differs from the baseline, between approval and merge | probe at merge time | no git merge; failing `check_ran git.merged` with that reason; card reopens |
| Pending approval | WRAP, approval not yet merged | no integration of the target into the run branch and no new merge card |

</frozen-after-approval>

## Code Map

- `src/cli/decide.ts` -- `mergeRun` (~:253) and its call at the end of `decide`: move the merge out; `merge_approved` validation in `build` stays as is.
- `src/cli/next.ts` -- `probe` (:128) skips `wrapProbe` while pending; `prepare` (~:470) runs the merge in WRAP when pending, outside the worktree, with no open steps; `housekeeping` unchanged (fallback `merged()` exit path stays for old runs).
- `src/core/verify.ts` -- add `mergePending(state, commands)`: phase WRAP, `merge_approved` true, and no `check_ran git.merged` after the last `merge_approved` event.
- `src/core/schedule.ts` -- `ScheduleCtx.merge_pending`; `wrap()` issues `exit_worktree` when pending and in the worktree, otherwise nothing; failure note uses the check's `error`.
- `src/core/events.ts` / `src/core/reducer.ts` -- `check_ran.data.error?`; `checks[].error` set only when present.
- `src/cli/git.ts` -- reuse `mergeInto`, `currentBranch`, `statusDigest`; `src/cli/check.ts` `mergedCheck`.
- `skills/factory/SKILL.md` -- `exit_worktree` can now come at WRAP before the merge.
- Docs: `_bmad-output/specs/spec-poc-factory-plugin/pipeline-stages.md`, `.../architecture-d2t-factory-2026-10-23/ARCHITECTURE-SPINE.md`, `src/cli/setup.ts:37,47`.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/events.ts`, `src/core/reducer.ts` -- additive `error` on check_ran -- 4b.
- [x] `src/core/verify.ts`, `src/core/schedule.ts` -- pending approval, `exit_worktree` before merge, card note with error -- 3, 4.
- [x] `src/cli/decide.ts`, `src/cli/next.ts` -- merge moves from decide into next, after exit; pre-merge branch/baseline recheck -- 3, 4.
- [x] `test/pipeline.test.ts`, `test/schedule.test.ts`, `test/reducer.test.ts` -- new order, failure → reopen → retry, error recorded and redacted, already-outside path.
- [x] `skills/factory/SKILL.md`, docs listed above -- WRAP order.

**Acceptance Criteria:**
- Given an approved merge, when the session is inside the worktree, then no `git merge` has run.
- Given a failed merge, when `next` runs, then a merge card offering `/factory merge` is open and its reason contains git's redacted error.
- Given the committed fixtures, when the test suite folds them, then their snapshots are byte-identical.

## Implementation Notes

- Sandbox check before implementing (2026-10-26): inside an entered worktree a write to main's `src/` is denied; after `ExitWorktree` (keep) it succeeds. Separately, `git worktree remove` of the entered worktree is denied even after exit (its `.git` file, `.claude/.cc-writes` and `.git/worktrees/<name>/commondir` stay write-protected); a worktree the session never entered removes fine. The post-merge removal will therefore report `worktree_error` under the sandbox (already non-fatal).
- Orchestrator added the pipeline case for "main differs from its baseline between approval and merge" (matrix row 4).
- Full-suite run 1: 418 pass, 1 fail (port 5100 taken during SCAFFOLD; a reviewer ran the suite concurrently); the test passes alone. `test/fixtures` unchanged.

## Review Triage Log

| # | Source | Finding | Verdict | Route / evidence |
|---|---|---|---|---|
| 1 | blind | main's branch gains a commit while pending; merge into an untested target | medium | patch: re-check only compared branch name and porcelain digest (no HEAD) |
| 2 | blind, edge | cwd outside worktree but not the repo root (subdir) still sandbox-blocked | low | rejected: conductor sessions start at the repo root; failure is visible on the card; fix adds a guard |
| 3 | blind, edge | post-merge `mergedCheck` failure leaves the commit but says aborted | low | rejected: unreachable after a successful `git merge` of that commit; pre-existing |
| 4 | blind | refusals before any merge record `command: git merge …` | low | patch: direct correction (omit `command`) |
| 5 | blind, edge | `ExitWorktree` may be a no-op after `/clear`, so the pending merge cannot proceed (reissue cap → escalation) | maybe-false (high if true) | defer: settle in dry run 3 with `/clear` inside the worktree before `/factory merge` |
| 6 | blind | two concurrent holder `next` calls both merge | low | rejected: no `--wait` runs in WRAP (cards only); fix needs a lock |
| 7 | blind | AD-8 keeps "a conflict issues a builder step"; diagram says exit_worktree unconditionally | low | patch: doc correction |
| 8 | blind | rework-from-main and refusal branches untested | low | rejected: builder briefs name the worktree (as on resume from main); refusal branches share one code path tested twice |
| 9 | blind | no recording fixture with the new order | low | rejected: refreshing the recording is a deliberate fixture change the intent excludes |
| 10 | blind | old approvals without target/baseline weaken the re-check | false | old `decide` refused without a branch, and baseline exists whenever `merge_approved` passed |
| 11 | blind | one-element loop in reducer test | low | rejected: cosmetic |
| 12 | verification-gap | no test pins which approval's sha is merged on a retry | medium | patch: unit test of `approvedMerge`, moved-head pipeline case |
| 13 | edge | `abandon` during the unlocked merge leaves an unrecorded merge commit | low | rejected: needs a human command in a ms window; old `decide` had the same gate failure |
| 14 | edge | repeat round after an unappended merge, with the new head check, records a done merge as failed | medium | patch: treat approved-sha-already-in-HEAD as merged first |
| 15 | edge | `git merge` fails without MERGE_HEAD, leaving main partly changed | low | rejected: pre-existing `mergeInto` behavior; dry run 2's sandbox failure aborted cleanly; the card shows the error |
| 16 | edge | a `cd` to main without ExitWorktree passes the guard | low | rejected: the skill forbids compound commands; merge would fail visibly |

## Design Notes

Merge in `prepare` (unlocked, holder only), events appended under the lock like other prepared events. If the seq changed meanwhile the round repeats; `git merge` of an approved commit already in HEAD is a no-op success, so a repeat records `merged` correctly. Card note: the error collapsed to one line, capped at 300 chars. A rework from the reopened card leaves the conductor in the main checkout; builders already work from the worktree path in their brief (same as a resume from main).

## Verification

**Commands:**
- `node --test test/*.test.ts` -- expected: all pass, no snapshot changes (`git status test/fixtures` clean).
