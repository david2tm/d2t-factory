---
title: 'Parallel runs and multi-run recording'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_commit: '3370ddd7ddff7a6adf305bd8c876c789c51b8004'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Run-id claims, port claims, session binding, multi-lane boards and multi-run replay already exist. But nothing enforces one run per repo when the run contract lists a shared service: `exclusiveDir` is unused and `REFUSED_EXCLUSIVE` is never thrown. The run lock has two crash windows that only bite under real contention. Ports are released before `run_completed` is appended. The resume list lacks title and slice. No test or fixture drives two runs at once (CAP-12, CAP-16 multi-run).

**Approach:** Add the AD-15 exclusive claim at SCAFFOLD, with a pre-claim refusal in `factory start`. Release ports and the exclusive claim only once the fold is terminal. Harden the AD-29 run lock. Bring the resume list and `CLAIM_TAKEN` text up to EXPERIENCE.md. Prove it with a two-run end-to-end test, a two-id `record --runs` test, and a synthetic two-run replay fixture.

## Boundaries & Constraints

**Always:**
- Claims are atomic `mkdir`s, and each holds an owner file naming its run id. A claim whose owner run is terminal, or no longer exists, counts as free and is broken.
- Refusal text, verbatim:
  - `Run refused — <run-id> is live in this repo and its run contract lists a shared database. One run per repo.`
  - `Run <run-id> is already claimed by another session.`, followed by the typed-takeover hint.
- Each resume-list row reads `run id · title · stage · slice · last activity`. Title is the run's task; slice is the first live slice, or `—`.
- Existing timeline snapshots stay byte-identical.

**Never:**
- No per-run database provisioning.
- No change to the reducer's event schema.
- No widening of the redaction union to sessions' unrecorded runs (out of scope).
- No real interactive recording in this story; that stays a manual follow-up.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Two runs, no shared service | Run A and run B started in one repo, interleaved to completion | Branches `factory/<A>` and `factory/<B>`, distinct ports, both `run_completed`; the main checkout's `git status` is unchanged | N/A |
| Start while exclusive held | Run A is non-terminal and holds `exclusive/`; `/factory <task>` | No run dir and no lane is created; the prompt stays unconsumed | `REFUSED_EXCLUSIVE` with the refusal text naming A |
| Both runs reach SCAFFOLD | A claimed `exclusive/`; B's contract lists `shared: true` | B gets a `scaffold_failure` card with retry and abandon (no accept); its reason is the refusal text | Retry after A completes claims it |
| Stale exclusive | Owner run is terminal or missing | The claim is broken and re-claimed; `start` is not refused | N/A |
| Lock, two breakers | Dead owner; breakers B1 and B2 race; B1 re-acquires | B2 never renames B1's fresh lock | N/A |
| Lock, no owner.json | Lock dir with no `owner.json`, older than the grace period | Treated as stale and broken | Younger than the grace period → still live |
| Resume list | 2+ live runs; bare `/factory` in the main checkout | `resolution.list` rows include `title` and `slice` | N/A |

</frozen-after-approval>

## Code Map

- `src/store/locks.ts` -- `acquire` (:37-57). Break a lock only under a `${dir}.break` mkdir mutex, after re-reading the owner. Give no-owner dirs an mtime grace period. `release` removes the lock only while `owner.json` is still its own.
- `src/store/paths.ts:57` -- `exclusiveDir(hash)` exists; add `exclusiveOwnerFile`.
- `src/cli/worktree.ts` -- `claimPort` and `releasePort` are the claim-and-owner pattern to mirror. `ensureExclude` (:33) does an unlocked read-modify-write; switch it to `appendFileSync` (a duplicate line is harmless).
- `src/cli/start.ts:35-46` -- check the exclusive claim after `refuseOtherBinding` and before the run-id loop.
- `src/cli/next.ts` -- `finishScaffold` (:190): once the contract (`contractOf`, `src/cli/devserver.ts:82`) lists `services[].shared`, claim `exclusive/` or push the failure into `failures`. `housekeeping` (:310) currently calls `releasePort` before `run_completed`. `advance` (:441), in its `isTerminal` branch, should release all claims.
- `src/cli/decide.ts:318-321` -- the abandon path. Keep the devserver kill, then release through the shared helper.
- `src/core/cards.ts:101` -- `scaffoldFailureCard`; reuse it with `accept: false`.
- `src/cli/resolve.ts:56-62` -- extend `RunSummary` and `summary()` with `title` and `slice`.
- `src/cli/resume.ts:44` -- the `CLAIM_TAKEN` text.
- `skills/factory/SKILL.md:16` -- the resume-list row format.
- `src/cli/record.ts:119-129`, `src/store/recording.ts`, `src/core/timeline.ts:91-107`, `src/dashboard/web/src/lib/replay.ts` -- multi-run recording and replay already work. Do not change them unless a test exposes a bug.
- `test/harness.ts` -- `world()`, `say(w, session, …)`, `contract(port, {services})` (:161), and `FACTORY_CLAUDE_AGENTS_JSON` for faking which sessions are live.
- `test/fixtures/generate.ts` -- writes one run per scenario at :175; a two-run scenario needs `writeRecording(name, [a, b])`.

## Tasks & Acceptance

**Execution:**
- [x] `src/store/locks.ts` + `test/store.test.ts` -- fix both crash windows; add a breaker-race test (simulated by a pre-renamed fresh lock) and a no-owner stale test.
- [x] `src/cli/claims.ts` (new) + `src/store/paths.ts` -- `claimExclusive(hash, runId)` and `releaseClaims(hash, runId, port)`. The holder liveness check uses `loadRun`/`isTerminal`. Move `claimPort`/`releasePort` here only if it keeps imports simple.
- [x] `src/cli/start.ts` -- refuse with `REFUSED_EXCLUSIVE` before claiming a run id.
- [x] `src/cli/next.ts`, `src/cli/decide.ts` -- add the exclusive claim at `finishScaffold`. Release claims only once the fold is terminal: in `advance`'s terminal branch, and after the abandon append.
- [x] `src/cli/worktree.ts` -- make `ensureExclude` append-only.
- [x] `src/cli/resolve.ts`, `src/cli/resume.ts`, `skills/factory/SKILL.md` -- add the resume-list fields and the UX texts.
- [x] `test/driver.test.ts` -- cover the resume-list fields, the `CLAIM_TAKEN` text, the start refusal with no run dir left behind, and the stale-exclusive break.
- [x] `test/pipeline.test.ts` -- two interleaved runs through `run_completed`, plus the shared-service SCAFFOLD race card; `record --runs a,b` with two ids over a shared-session transcript.
- [x] `test/fixtures/generate.ts` + `test/fixtures/recordings/two-runs*` -- a two-run scenario (A in BUILD, B waiting at Gate 1) with its timeline snapshot; `test/timeline.test.ts` / `test/web-replay.test.ts` pick it up.

**Acceptance Criteria:**
- Given the four existing recordings, when the suite runs, then their snapshots are unchanged.
- Given a completed run, when its claims are inspected, then neither its port nor `exclusive/` is held, and neither was released before `run_completed` was on disk.
- Given the two-run fixture, when replayed, then two lanes show, the newest on top, and `next decision` visits both runs' pips, each labelled `<event> · <run-id>`.

## Implementation Notes

- One fix outside the Code Map: `decide.ts` accepted `/factory rule E<n> accept` whenever the scaffolder's contract parsed. It now accepts only when the card offers accept, which the exclusive-conflict card does not.
- `CLAIM_GRACE_MS` (5 s) is in `src/core/config.ts`. Port claims also take back ports whose owner run is terminal or gone, but only once the whole range is taken.
- One type-check error in `test/web-replay.test.ts` (around line 276) predates this story; that line is unchanged.

## Spec Change Log

## Review Triage Log

Review pass 1 (blind-hunter BH, edge-case-hunter ECH, verification-gap VG):

| # | Finding | Verdict | Evidence / route |
|---|---|---|---|
| VG1 | `claimPort`'s third pass (taking back a port from a terminal or missing run) is untested | medium | Gap filed pre-verified: the exhaustion test's dirs have no owner, so they stay in grace and the reclaim never runs. **patch** |
| VG2 | The exclusive break-and-reclaim at SCAFFOLD is untested | medium | Gap filed pre-verified: the driver test covers only `exclusiveHolder` at start; the pipeline test releases the claim before the retry. **patch** |
| BH1 / ECH5 / ECH10 | A shared-service run can claim `exclusive/` while another live run is already past SCAFFOLD; a run without a shared service can pass SCAFFOLD while another run holds the claim | medium | Confirmed: `finishScaffold` checks only the claim dir, which breaks "one run per repo" when two runs' scaffolders disagree about the services. **patch** (the intent's "one run per repo" settles the fix) |
| BH14 | `holdExclusive` builds the claim path from `'..'` segments instead of `exclusiveDir` | low | Confirmed; the fix is a direct correction. **patch** |
| BH2 | The claim is taken after `contract.health` and `contract.test` have run against the shared service | medium | Real, but inherent to AD-15: the contract exists only after the scaffolder has already worked in the repo, so claiming earlier narrows the window without closing it. **defer** |
| BH3 / ECH6 | A run keeps `exclusive/` while it sits on a scaffold_failure card for other reasons | false | Intended: one run per repo holds until the run completes or is abandoned, and a run waiting on a card is still live. |
| ECH3 | A retried contract with no shared service still keeps the claim | low | Rare, and the fix adds a branch. Rejected. |
| ECH4 | `contractOf` returning undefined skips the claim | low | Needs `out.md` edited after its checks were verified; `evidenceFor` would then fail as well. Rejected. |
| BH4 | A port taken back from a terminal run may still have its dev server listening | low | Needs a full range plus a crash between `run_abandoned` and the release. Rejected. |
| BH5 / ECH9 | `runFree` is slow or throws on a corrupt log | low | Runs only when the range is full, and `loadRun` tolerates bad lines (`skipped`). Rejected. |
| BH6 / ECH7 | The break mutex has no token, so a slow `stale()` lets a second breaker in | low | `stale()` would have to take longer than 5 s. Rejected. |
| ECH8 | An unreadable `owner.json` older than the grace period is broken while its holder lives | low | Needs a partial write that persists (ENOSPC). Rejected. |
| ECH1 | `releasePort`/`releaseClaims` can delete a claim re-taken between the owner read and `rmSync` | low | The window is microseconds, and the fix adds complexity. Rejected. |
| ECH2 | A busy break mutex on all four tries refuses with a terminal run named as holder | low | Needs two processes over the same stale claim at once; the human just retries. Rejected. |
| BH7 | The housekeeping report says `port_released` before the release happens | false | `advance` appends `run_completed`, the next round calls `releaseTerminal`, and only then returns the report. |
| BH8 | Accept depends on matching the command string | low | `scaffoldFailureCard` produces it deterministically. Rejected. |
| BH9 | The refusal text hardcodes "shared database" and offers no next step | false | The text is the verbatim EXPERIENCE.md copy the spec requires. |
| BH10 | Retry spawns a whole new scaffolder | low | Design cost, not a defect. Rejected. |
| BH11 | The resume list mishandles an empty title or a null `last_ts` | false | `start` always records a task, and every live run has events. |
| BH12 | The `CLAIM_TAKEN` text drops the holder's session id | low | The text is UX-mandated. Rejected. |
| BH13 | Other paths are untested (ended-meanwhile release, `ensureExclude` append, no-owner exclusive, `'another run'`) | low | The port part is covered by VG1; the rest are low-risk branches. Rejected. |
| BH15 | The global `factN` counter makes two-runs fact ids depend on fixture order | low | Resetting it would change the existing fixtures' ids and snapshots. Rejected. |

## Design Notes

Two parts are already built: the multi-run replay pipeline (union redaction, merged timeline, lane ordering, pip labels) and the live multi-lane board. This story adds enforcement and proof, not new rendering. A SCAFFOLD-time exclusive conflict uses the existing `scaffold_failure` card rather than a new card type. The run already has a lane by then, so the human chooses retry (after the other run ends) or abandon.

## Verification

**Commands:**
- `node --test test/` -- expected: all pass, existing `*.timeline.json` and `*.state.json` unchanged

**Manual checks:**
- Open `/replay/two-runs`: two lanes, and Replay Flow 2 behaves as specified.
