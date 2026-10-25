---
title: 'Full build loop and escalations'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/specs/spec-poc-factory-plugin/review-policy.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** BUILD runs one slice at a time, so the builder idles through every review. No slice time box is enforced. An agent whose output keeps failing to parse is reissued forever. An open step on a cut slice blocks its role for the rest of the run. Escalation cards carry no condition, so nothing proves each ask is on the closed list. `/factory rerun` is refused (CAP-8, CAP-10, CAP-1).

**Approach:**
- **Pipelining (AD-30).** The worktree has one writer at a time: a builder step, a `contract.test`/`contract.health` check and the running-app reviewers never overlap. Diff reviewers read code at their slice's sha, so they may run while the builder works. The next Backlog slice (plan order) starts when:
  - its `depends_on` slices are all CLOSED or CUT;
  - no slice is BUILDING or owes a builder round;
  - every slice in review has a passing round test and no running-app reviewer still due;
  - the cut card is not open.

  The builder goes to the earliest slice that wants it. So findings on S*n* that settle while S*n+1* builds are fixed (resumed S*n* builder) before S*n+1*'s test and reviewers are issued. One open step per role still holds (AD-3): a reviewer role busy on one slice takes the next slice afterwards.
- **Time box (AD-17).** Elapsed = wall time since `slice_started`, minus time the slice had an open escalation. When it reaches `(k+1) × slice_timebox_min` (k = Over time box rulings already made on that slice), the CLI raises `Over time box: S4 at 34 / 30 min.` (condition 3) and the slice goes ESCALATED. Work in flight finishes; nothing new is issued for an ESCALATED slice. **Rulings (decided 2026-10-25):**
  - `rule En retry <note…>` grants another full time box, and the note goes to that slice's builder. The slice returns to the state its evidence implies: BUILDING, IN_REVIEW or FINDINGS_QUEUED.
  - `rule En cut` moves the slice to CUT. Its commits stay on the run branch and in the merge diff, its open steps are cancelled, and the budget cut gate is unaffected.
  - `abandon` is always available. The time box is a `next --wait` deadline, and the board shows a Time box meter on live slices.
- **Reissue cap.** A step whose attempt reaches `MAX_STEP_ATTEMPTS` (3, in `config.ts`) raises a Non-convergence escalation instead of another reissue. Triggers are a parse failure or an orphan reissue. `retry <note…>` buys one more attempt. A reissued `resume` becomes a `spawn`. This is the fallback when SendMessage can't reach a finished builder: the conductor runs `factory done`, which finds no output.
- **`step_cancelled{step_id, reason}`** (new command kind; step state `cancelled`). The CLI appends it for any open, non-card step whose slice is CUT or gone, or which was voided.
- **Closed ask list.** Escalation cards carry `condition`:
  - 1: Scope change, Spec ambiguity.
  - 2: Irreversible action, New dependency.
  - 3: Non-convergence, Over time box.
  - 4: Taste disagreement.

  `Scaffold failed` is a parse error for any role but the scaffolder. `git.deps` diffs only the slice's own builder commits, so an accepted dependency is not raised again on later slices.
- **Rerun (AD-33).** `/factory rerun RECON|SPEC|DESIGN|SLICE_PLAN` is legal only while parked, meaning every open step is a card. Its `voids` cover:
  - the stage's steps, their `step_verified` and lint checks;
  - every later gate pass and later-stage step;
  - every slice-bound step and `slice_closed`.

  Open asks close. **Code already built stays on the run branch (decided 2026-10-25),** and the new plan's builders build on top of it. A RECON rerun refreshes the recon cache and skips SCAFFOLD when a verified scaffolder exists. FRAME stays refused until 5-2.

## Boundaries & Constraints

**Always:**
- `schedule`, `budget`, `cards`, `verify`, `reducer` and `projection` stay pure. Time enters as `nowMs`/commands arguments only.
- Events stay additive within `v:1`, and the fixture `*.state.json` shasums are unchanged.
- A plan with one slice, or with only dependent slices, keeps today's step order.
- Cards come only from `core/cards.ts`. The board reads command data only.
- Agents never start servers or commit.

**Never:**
- Running two builder steps at once, or running a contract check while a builder step is open.
- Resetting or rewriting the run branch.
- New npm dependencies, or regenerated `test/fixtures`.
- Greenfield, FRAME and multi-run work: those are epic 5.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pipeline | S1, S2 independent; S1's test passes | One `next` issues S1's diff reviewers, and `slice_started` S2 plus the S2 builder | S2 `depends_on: [S1]` → S2 starts only after S1 closes |
| Queued findings | S1 reviewer-code FINDINGS while the S2 builder is claimed | S1 FINDINGS_QUEUED. After S2's builder `done`: S1 builder round (resume), S1 test, then only reviewer-code on S1. S2's test is issued only after that | — |
| App slice | S1 has ux; S2 independent | S2 starts only after S1's health and ux are verified | — |
| Time box | 30-min box, S2 started 31 min ago, 5 min of it escalated | Not raised (26 min). At 30 min net: `Over time box: S2 at 30 / 30 min.` | — |
| Reissue cap | builder output fails to parse on attempt 3 | `ask_raised` Non-convergence (condition 3), slice ESCALATED, no reissue | `retry` → attempt 4 |
| Cut | an ESCALATED slice with a claimed reviewer is cut | `step_cancelled` for that step; the role is free again | `done` on a cancelled step → ILLEGAL_TRANSITION |
| Rerun | `/factory rerun SLICE_PLAN` at an escalation card in BUILD | Phase SLICE_PLAN, slices cleared, open cards cancelled, a fresh slicer due; built commits stay | Not parked (an agent step open) → ILLEGAL_TRANSITION |

</frozen-after-approval>

## Code Map

- `src/core/config.ts` -- add `MAX_STEP_ATTEMPTS = 3`.
- `src/core/events.ts` -- add `step_cancelled {step_id, reason}` to COMMAND_KINDS and REQUIRED. Add `Card.condition?: 1|2|3|4`. Add `step_reissued.kind?: 'spawn'`. Widen `escalation_ruled.slice_to` to any `SliceState`.
- `src/core/reducer.ts` --
  - Add StepState `cancelled`: open steps only.
  - In `step_reissued` (:228), use `data.kind` and drop `agent_id` when it is `spawn`.
  - `stage_rerun_requested` (:353) closes every open ask.
  - `escalation_ruled` (:323) moves to `slice_to` (ESCALATED → CUT is allowed).
- `src/core/verify.ts` --
  - `latestStep` (:16) skips `cancelled`.
  - Replace `activeSlice` (:207) with `liveSlices` (started, not CLOSED/CUT) and `nextBacklog`.
  - In `closeEvidence` (:306), only this slice's open builder blocks.
  - Add `wantsBuilder(s, slice)`, `evidenceState(s, slice)` (the ruling's `slice_to`), `rerunVoids(s, commands, stage)` and `sliceDeps` (builder shas).
- `src/core/schedule.ts` `build()` (:145) -- multi-slice per the Approach; one step per role per batch, earliest slice first. Its `ScheduleCtx.resume_agent` becomes `resume_agents: Record<slice, id>`.
- `src/core/budget.ts` -- `sliceTimebox(s, commands, slice, nowMs)` returns `{elapsed_ms, ends_at, over}`. `deadlinesAhead` takes the live slices' `ends_at` values.
- `src/core/cards.ts` -- add `overTimeboxCard` and `stepNonConvergenceCard`; `condition` on every escalation card (label map).
- `src/core/output.ts` -- `Scaffold failed` is valid only for the scaffolder.
- `src/cli/next.ts` --
  - `buildEvents` (:202) loops over the live slices:
    - start the next slice;
    - time box raise;
    - Non-convergence;
    - close, with `git.deps` over `sliceDeps`, skipped in greenfield.
  - `prepare` cancels steps per the Approach.
  - `resumeAgent` (:58) works per slice.
  - `view` (:347) adds the time box deadlines.
  - In `completeOrient`, a rerun overwrites the cache; a verified scaffolder gets `stage_completed{SCAFFOLD}`.
- `src/cli/steps.ts` -- `reissueOrEscalate` (cap, used by `done.ts:83`, `next.ts:283/287`). In `reissueEvent` (:126), a `resume` is reissued as a `spawn`.
- `src/cli/decide.ts` --
  - Remove `stage_rerun_requested` from `LATER` (:30) and enforce the parked rule.
  - Add `Over time box` to `CLI_SLICE_ASKS` (:66): `retry <note…>` sets `slice_to` from `evidenceState`, and `cut` sets `slice_to: 'CUT'` without setting `cut_decided`.
  - `slice_to` comes from `evidenceState`.
- `src/cli/brief.ts` --
  - Diff reviewers (:200) read at the slice sha (`git show <sha>:<path>`) and run no tests while another slice builds.
  - The builder fix brief names the slice. Time box retry notes go to that slice's builder.
- `src/core/projection.ts` + web `types.ts`/`SliceCard.svelte` -- add `timebox_ends_at`/`timebox_min` on live slice cards and `deadlines.timebox_ends_at`, plus the meter (`12 / 30 min`, amber when over).
- `skills/factory/SKILL.md` -- on a SendMessage error, run `factory done <step_id>`; on ILLEGAL_TRANSITION for a cancelled step, continue the loop. `agents/reviewer-{code,security}.md`: read at the sha.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/{config,events,reducer,verify,budget,cards,output,schedule}.ts` -- core per the Code Map.
- [x] `src/cli/{next,steps,done,decide,brief}.ts` -- pipelining, time box, cap, cancel and rerun on the CLI side.
- [x] `src/core/projection.ts`, web `types.ts`/`SliceCard.svelte` -- the time box meter.
- [x] `skills/factory/SKILL.md`, `agents/reviewer-{code,security}.md` -- conductor fallbacks; review at the sha.
- [x] `test/{schedule,verify,budget,cards,reducer,projection,pipeline}.test.ts` -- every matrix row. The pipeline tests backdate `slice_started` in `commands.jsonl` to reach the time box.

**Acceptance Criteria:**
- Given a brownfield run through `bin/factory` with S1, S2 (independent) and S3 (`depends_on: [S2]`), when S1's reviewer raises FINDINGS during S2's build, then the step order matches the Queued findings row, S3 starts after S2 closes, the merge card lists all three, and every command passes `validateEvent`.
- Given every card the CLI can raise, when listed, then each one maps to exactly one closed-list entry (a planned gate, an escalation with `condition` 1–4, or a declared ask).
- Given the repo, when Verification runs, then all tests pass, tsc reports 0 errors, and the fixture shasums are unchanged.

## Implementation Notes

Readings taken where the spec left room (none changes the frozen intent):

- **Reissue cap counts the reissue chain.** `MAX_STEP_ATTEMPTS` is compared with the number of attempts in the step's own `step_reissued` chain (`attemptsInChain`), not the `attempt` field, which also counts a rework's or a design choice's fresh respawn (a designer at attempt 3 after two gate-1 reworks still gets its own 3 tries). For a fresh step the two agree, so the matrix row (fails on attempt 3 → Non-convergence; retry → attempt 4) holds as written.
- **Time box start.** Measured from the slice's latest `slice_started`, or a later `rework_requested` of it (a slice sent back from the merge card gets a fresh box instead of being over at once), within the current plan (after the last `gate_2_passed`). `k` counts Over time box rulings since that start. Runs without a 3-1 intake have no time box (as with the budget clock).
- **Start order.** The next Backlog slice is strictly the first one in plan order. An ESCALATED slice also holds back new starts (it may come back to the builder, and the human may want to rerun while parked). A running-app reviewer kept out by a failing health check still counts as "still due" (it must judge this slice's code, not the next slice's).
- **Cut with a builder at work.** A claimed builder of a cut slice keeps the builder role (one builder at a time) until its `done` commits and reports it (unverified); `next` cancels it then. Other open steps of a cut slice are cancelled at once.
- **Parked.** The AD-12 definition the board already uses: every open step is an `ask_human` card or the subject of an open ask (so a rerun is possible at an agent's own ESCALATE). `/factory rerun` cancels every open step with the decision (cards and their subjects).
- **git.deps over the slice's own commits.** The dependency files the slice's own builder commits touched (a file another slice alone changed is never raised on it, even with that slice's commits in between), counted by the net change from before the slice's first commit to its last, so a dependency the slice added and later removed (a merge-card rework) is not raised. A manifest is a dependency file by name, so any change the slice itself makes to it is raised.
- **Ruling targets.** Non-convergence and New dependency `retry` still send the slice to BUILDING (that retry is one more builder round); New dependency `accept`, an agent escalation's retry and the Over time box retry use `evidenceState`.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-25): blind-hunter (B), edge-case-hunter (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| B3/E4/E19 | Cutting a slice whose builder is still claimed frees the builder role and writer slot while the agent keeps editing; the next builder's commit sweeps in its edits | high | Over time box is raised without the slice being idle (`buildEvents` time box check); `prepare` cancels the claimed builder at once; `schedule.build` then issues another builder. This breaks the frozen Never "two builder steps at once" | patch: don't cancel a *claimed* builder of a CUT slice; its `done` commits and reports without verifying, and the reported step is then cancelled |
| B2/E6/E15 | `sliceDepFiles` diffs the net range `first^..last`, so another slice's edit to a shared dependency file between this slice's commits is raised on this slice | medium | Its filter keeps only files this slice touched, but the content comes from the net range; when S1 and S2 both edit `package.json`, S2's dependency appears in S1's diff | patch → no code change: the net set is always a subset of the union and names only files this slice touched; since any manifest edit counts and the card names files, the union raises the same files. A test now pins that S2's change between S1's commits is not raised at S1's close |
| B1/E11 | Diff reviewers get `git diff base_sha..sha`, which holds other slices' commits (all earlier slices, and an interleaved later one under a fix commit) | medium | `brief.ts` diff-reviewer facts; slices share one linear branch | patch: the brief also lists the slice's own commits (`sliceDeps`) and says to review only those |
| B8/E12 | A builder round for an earlier slice can take the writer slot between a later slice's passing health and its app reviewers, so they judge a moved head | medium | `build()` iterates plan order: S1 `wantsBuilder` sets writer=builder before S2's app reviewers; health is not rerun | patch: no builder is issued while some slice has passing health with due app reviewers not yet issued |
| B6/E10 | After `rerun SLICE_PLAN` the new plan reuses ids, so old S<n> retry and rework notes reach the new S<n>'s builder | medium | `retryNotes` and `reworkNotes` scan every command and match on role and slice id only | patch: slice-scoped notes count only commands after the last `gate_2_passed` |
| E3 | A step cancelled while it is the subject of another open ask (a reviewer escalated during an Over time box, then `cut`) leaves that ask unrulable: retry is refused and only abandon remains | medium | `raise` drops the slice on an ESCALATED slice; the ask keeps `step_id`; the `decide` retry needs an open subject | patch: `step_cancelled` closes open asks whose subject it is, and `prepare` cancels the card steps of closed escalations |
| B10/E1 | A second `factory done` on a step escalated at the reissue cap raises a duplicate Non-convergence ask | medium | `done.ts` has no `askOpenFor` guard; the step stays claimed and `attemptsInChain` is still at the cap | patch: `done` on a step with an open ask is ILLEGAL_TRANSITION |
| E13/B10b | The MISSING_EVIDENCE text reads "attempt 4 of 3" after a retry | low | `done.ts` message | patch: word it as "attempt N (cap 3)" |
| B11 | When no slice is building, the brief's fallback line still says "run no tests while another slice builds", so the reviewer can't tell whether tests are allowed | low | `brief.ts` `building.length ? … : …` | patch: say plainly that no other slice is being built now and tests may run |
| V1 | `checkOutput` passing the role is untested for a non-scaffolder | medium (pre-verified) | Only `parseOutput` is tested directly | patch: assertion in `artifacts.test.ts` |
| V2 | A second escalation on an already-ESCALATED slice (the `raise` live guard) is untested | medium (pre-verified) | Every ESCALATED assertion is a first escalation | patch: extend the time-box pipeline test |
| V3 | The reissue cap and its re-raise guard on the orphan path are untested | medium (pre-verified) | The orphan test stops at attempt 2 | patch: an orphan to attempt 3, then a quiet `next` |
| V4 | `next`'s `retry_after_ms` never checks the time box deadline | medium (pre-verified) | Only budget unit tests pass `timeboxes` | patch: a driver test with a box ending inside `WAIT_MAX_MS` |
| V5 | A DESIGN rerun past gate 1 (the voided-gate-card filter) is untested | medium (pre-verified) | Only SLICE_PLAN and RECON reruns run end to end | patch: a schedule test reaches a fresh gate_1 |
| V6 | `retryNotes` slice scoping is untested | medium (pre-verified) | Every retry-note assertion is positive, on the same slice | patch: `doesNotMatch` on S2's brief |
| V7 | The abandon seal on several live slices is untested | low (pre-verified) | One live slice only | patch: a two-slice abandon projection case |
| V8 | The Non-convergence card's dependency list is not checked end to end | low (pre-verified) | Unanchored regex; `git.deps` at close uses the same function and is tested | defer |
| B4 | A cut or replanned slice's unreviewed commits are merged with no warning | low | By decision: frozen intent says the commits "stay on the run branch and in the merge diff"; the human chose `cut` or `rerun` knowing that | reject |
| B5/E7 | A RECON rerun appends `stage_completed SCAFFOLD` even when the baseline check fails | low | Real, but the merge is still blocked on the baseline (`decide` digest check and `mergeEvidence`). It needs a RECON rerun with a changed main checkout, and a fix would need a new card path | reject |
| B7a/E14 | A SPEC rerun keeps the design | low | SPEC and DESIGN are sibling stages (AD-3); the new gate_1 card shows the kept design again for approval, and `rework gate1` voids it | reject |
| B7b/E9 | `cut_decided` is not reset by a rerun | false | AD-30: any `cut_decided` "suppresses a cut re-raise for the rest of the run" | reject |
| B9 | The time box counts time queued behind other slices | false | Frozen intent: elapsed = wall time minus open-escalation time only | reject |
| B12 | The escalation pause uses the latest `open_since` and double-counts overlaps | false | `raise` drops the slice on an ESCALATED slice, so only one slice-carrying ask is ever open per slice; no overlap is possible | reject |
| B13 | `parseOutput` treats `{role: undefined}` differently from no options | false | Undefined-role callers get the strict rule, which is the intended direction; no caller is shown to break | reject |
| B14a | A CUT dependency counts as satisfied | false | Frozen intent: "depends_on slices are all CLOSED or CUT" | reject |
| B14b | Only the first Backlog slice can start | false | Frozen intent: "the next Backlog slice (plan order)" | reject |
| B15 | Missing-test list, `assert.ok` noise, unused `SLICE_TIMEBOX_DEFAULT_MS` | low | The tests are covered by V1–V7 and the patch tests; the constant is used in `artifacts.ts` and `brief.ts` | reject |
| E2 | A step-level Non-convergence `accept` could close a slice when its subject left the open state | low | Unreachable once `done` is guarded (B10); the card offers retry and abandon only | reject |
| E5/E18 | An escalated builder or app reviewer holds its role and the writer slot, stalling other slices | low | AD-3: the reducer refuses a second open step of a role, so this is mandated; it lasts only while the human rules | reject |
| E8 | An agent's own `Over time box` ESCALATE counts toward k | low | Unlikely (agents escalate with their own labels), and the fix adds a condition | reject |
| E16 | `nextBacklog` also blocks on an ESCALATED slice, which the spec does not list | low | A recorded reading: a slice escalated with its builder held would only burn a new slice's box; it costs throughput only while the human rules | reject |
| E17 | The cap counts the reissue chain, not `attempt` | false | A recorded reading; the matrix row (attempt 3, then retry is attempt 4) holds | reject |

## Design Notes

- **Why the start condition waits for running-app reviews.** Health restarts the dev server at the worktree HEAD. Starting S*n+1* first would either block S*n*'s ux/a11y/ui reviewers behind a whole build, or let them judge S*n+1*'s half-built code.
- **Why `step_cancelled` and not a fake `step_verified`.** A verified builder step would count as a round's builder (`roundOf`), and on a cleared slice the reducer's slice lookup would throw.

## Verification

**Commands:**
- `node --test test/` -- expected: all pass (port-binding tests run outside the sandbox).
- `npm i --prefix "$TMPDIR/tsc" --cache "$TMPDIR/npm-cache" typescript@7.0.2 @types/node@22 && "$TMPDIR/tsc/node_modules/.bin/tsc" -p tsconfig.json --typeRoots "$TMPDIR/tsc/node_modules/@types"` -- expected: exit 0.
- `shasum test/fixtures/*.state.json` before and after -- expected: identical.
