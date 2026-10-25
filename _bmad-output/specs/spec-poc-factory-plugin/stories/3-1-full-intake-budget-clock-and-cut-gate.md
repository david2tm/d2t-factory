---
title: 'Full intake, budget clock, and cut gate'
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** INTAKE is a stub: `/factory approve intake` confirms nothing, so the run knows no time limit, slice time box, UI-free flag or reviewer overrides. With no budget, nothing can raise the cut gate, and a foreground conductor could not show it mid-build anyway (CAP-2, CAP-11).

**Approach:**
- **Intake.** The conductor runs the intake conversation in chat and writes the intake `out.md` (AD-27 schema). `factory done` parses it, and a confirm card shows the four fields. `approve intake` pins the file and records the fields.
- **Budget clock.** It starts at `run_started.ts`, or at the earlier `started` from intake.
- **Cut gate.** In BUILD, once the clock passes limit − `CUT_LEAD_MS` with Backlog slices left, the CLI raises a live cut card that `/factory cut …` or `/factory keep` answers.
- **Conductor.** It runs agents and `next --wait` in the background (AD-17), so the card appears on time.
- **Board.** It shows the clock and the AT RISK cards.

## Boundaries & Constraints

**Always:**
- AD-17: time sets flags only. The cut is an `ask_raised` that the CLI appends; `reducer`, `schedule`, `cards` and `projection` stay pure.
- The constants live in `core/config.ts`.
- Event changes are additive within `v:1`, and the fixture `*.state.json` shasums stay unchanged: the new state fields are set only when the new data is present.
- Every card comes from `core/cards.ts`, and its `commands` list only legal decisions.
- The CLI writes the intake brief. The conductor writes only the intake `out.md` under `~/.factory`.

**Never:**
- The slice time box clock or `Over time box` (3-4).
- The designer, the roster, or any use of `ui_free`/`reviewer_overrides` beyond validating, recording and showing them (3-2, 3-3).
- Cutting a slice that is not BACKLOG.
- A cut outside BUILD, or a cut planned before its deadline.
- Monitor tools or busy polling.
- New npm dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Intake recorded | The conductor writes a valid intake `out.md` and runs `done` | `step_reported{output}`. `next` issues a confirm card (`type: intake`): `limit 2:00 · slice time box 30 min · UI-free no · reviewers: default`, with commands `['/factory approve intake']` | Bad front matter → `MISSING_EVIDENCE`. Nothing is appended, and the step stays claimed for a fix and a rerun |
| Intake changed | `done` again on the reported intake step, after a rewrite | The CLI reissues the step (same `output_path`) and reports the new step. The stale confirm card is closed (`superseded:`), and a fresh card follows | — |
| Approve | Confirm card open; file unchanged since `done` | `intake_confirmed{intake, clock_start, pins}`, and the phase becomes ORIENT. A missing `slice_timebox_min` becomes 30 | No recorded intake → `ILLEGAL_TRANSITION`. File changed → `MISSING_EVIDENCE` |
| Clock start | `started` is earlier than `run_started.ts` / later / absent | `clock_start` = `started` / the run start / the run start | `started` that won't parse → schema error |
| Cut raised | BUILD, now ≥ `cut_at`, ≥ 1 BACKLOG slice, no `cut_decided`, no open cut | `ask_raised{card: cut}` (`Cut point reached — 2 slices unbuilt. Cut S2, S3?`, with commands `/factory cut S2,S3` and `/factory keep`), then an `ask_human` step that carries it. No slice starts while it is open | Deadline passed before BUILD → raised before S1 starts |
| Cut / keep | `/factory cut S3` or `/factory keep` while the card is open | `cut_decided`; S3 → CUT; the ask is closed and its step verified; BUILD goes on; never re-raised | No open cut card, or a non-BACKLOG slice → `ILLEGAL_TRANSITION` |
| Wake | Only background work or cards are in flight, and a deadline is ahead | `wait.retry_after_ms` = min(ms to `cut_at` or the earliest claim `overdue_at`, `WAIT_MAX_MS`). `next --wait` returns early only when it would issue steps or the run is done | No deadline → `WAIT_MAX_MS` |
| Board | Intake confirmed; cut card open | Lane `budget` and `deadlines.{cut_at, ends_at}`. BACKLOG slice cards carry `at_risk: true` | No intake → `budget: null`, and the deadlines stay null |

</frozen-after-approval>

## Code Map

- `src/core/schedule.ts` `due()` -- INTAKE today issues one stub card.
  - The conversation step and the confirm card go here.
  - Generalize the escalation loop (`:169`) so an open `cut` ask also gets its `ask_human` step.
- `src/core/cards.ts` `intakeCard()` -- the stub. Split it into a conversation card (no commands) and `intakeConfirmCard(fields)`. Add `cutCard(slices)`.
- `src/core/reducer.ts` -- leave the existing cases alone, and make two additive changes:
  - `intake_confirmed` (`:270`) sets `s.intake` only when `data.intake` is present.
  - `cut_decided` (`:324`) also closes open asks whose `card.type === 'cut'`.
- `src/core/events.ts` -- add optional `intake_confirmed.{intake, clock_start, pins}`.
- `src/core/artifacts.ts` `SCHEMA` -- add `validateIntake`. `checkOutput('intake', …)` must reject ESCALATE.
- `src/core/config.ts` -- `CUT_LEAD_MS`, `SLICE_TIMEBOX_DEFAULT_MS` and `NEXT_RETRY_AFTER_MS` exist. Add `WAIT_MAX_MS`.
- `src/cli/next.ts`:
  - `prepare()`/`buildEvents()` -- the cut raise goes before `slice_started`.
  - `issueDue()` (`:313`) gives the INTAKE ask step an `output_path` and a brief.
  - `view()` (`:329`) sets the wait; `next()` (`:383`) runs the wait loop.
- `src/cli/done.ts` -- the generic ask_human branch (`:64`) gains the intake parse and re-report. Reuse `reissueEvent`, `makeEvent` and `sha256`.
- `src/cli/decide.ts`:
  - `intake_confirmed` (`:70`) gains the evidence and the pin; follow `pinOf` (`:55`).
  - Remove `cut_decided` from `LATER` (`:27`) and add its case.
- `src/cli/brief.ts` -- add an intake brief writer. `briefText` is agent-shaped ("never run factory"), so don't reuse it.
- `src/core/projection.ts`:
  - `Deadlines` (`:54`) -- fill `cut_at` and `ends_at`.
  - Lane `budget`, and BoardCard `at_risk`.
  - The intake cards already skip Needs You (`:210`). The cut card must not appear twice (ask plus step).
- `src/dashboard/web/src/{lib/types.ts,lib/model.ts,components/Lane.svelte,components/SliceCard.svelte}`:
  - `Lane.svelte:52` reserves the budget slot.
  - DESIGN.md:578 specifies the Budget clock and DESIGN.md:590 the AT RISK variant.
- `skills/factory/SKILL.md` -- the conductor loop. `core/stop.ts` already lets a turn end over background subagents (spike 05).
- `test/driver.test.ts`, `test/pipeline.test.ts:81`, `test/harness.ts` -- about 20 tests call `approve intake` with no intake. Give them a `recordIntake()` helper.
- Don't regenerate `test/fixtures`.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/{config,events,artifacts,cards,reducer,schedule}.ts`, plus a new `src/core/budget.ts` -- schema, cards, state and `due` per the Code Map. `budget.ts` (pure) holds `budgetOf(s)`, `cutCandidates(s, nowMs)` and `nextDeadlineMs(s, nowMs, overdue)`.
- [x] `src/cli/{next,done,decide,brief}.ts` -- intake report/re-report, approve evidence and pin, the cut raise and decision, and the wait.
- [x] `skills/factory/SKILL.md`:
  - **Agents in the background.** `spawn` runs with `run_in_background: true`. When a completion notification arrives, the conductor runs `factory done` and then the loop.
  - **Waits.** On `wait`, run a background `factory next --wait <ms>` and end the turn. When it exits, run a fresh `factory next`.
  - **`<task-notification>` and plain chat turns** skip `decide`.
  - **The INTAKE step.** Read its brief, converse, write the `out.md`, then `done` (again after changes, using the returned `step_id`).
- [x] `src/core/projection.ts` + `src/dashboard/web/src/**` + `dashboard/dist/` -- the deadlines, `budget` and `at_risk`.
  - The `BudgetClock` component: `1:12 left of 2:00`, the cut marker, and `+m:ss over` in amber.
  - The AT RISK slice variant.
  - Rebuild `dist`.
- [x] `test/{artifacts,cards,schedule,reducer,budget,projection,web-model,driver,pipeline}.test.ts` -- unit-test every matrix row; migrate the stub-intake tests to `recordIntake()`.

**Acceptance Criteria:**
- Given a brownfield run started through `bin/factory`:
  - **When** intake records `started` 2 h ago and `limit_min: 100`, is approved, and the run reaches BUILD with S1–S3 (1-4's sequence), then `next` raises the cut card before `slice_started S1`.
  - **When** `/factory cut S2,S3` is decided, then S2 and S3 are CUT, S1 builds, no second cut card appears, and every command passes `validateEvent`.
- Given the repo, when Verification runs, then:
  - all tests pass;
  - tsc reports 0 errors;
  - the fixture shasums are unchanged;
  - `dashboard/dist` rebuilds byte-identical.

## Implementation Notes

- **Verification (2026-10-24).**
  - `node --test test/`: 237 pass outside the sandbox. Inside it, 19 tests skip because they need to bind local ports.
  - tsc 7.0.2 exits 0.
  - The fixture shasums are unchanged.
  - Rebuilding `dashboard/dist` is byte-identical.
  - A Playwright screenshot of a lane with the cut card open and one past 0:00 matches States 03.
- **Beyond the Code Map.**
  - `src/hooks/guard.ts` `writableDirs`: the write guard also allows the open INTAKE conversation's out.md dir while that step is claimed or reported. Without it, the conductor could not rewrite the intake after a reported `done`.
  - `test/hooks.test.ts` and `test/guard.test.ts` were migrated to `recordIntake()`.
  - New clock glyph in `sprites.ts`.
- **Choices.**
  - `NEXT_RETRY_AFTER_MS` was replaced by `WAIT_MAX_MS` plus the deadline logic.
  - The cut point is a wake deadline only in BUILD. A cut point that passed earlier raises the card on BUILD entry.
  - The dashboard cache schema version is unchanged. A cached lane with no `budget` renders as no clock.
- **Not exercised live.** Background agents, the task-notification wake-ups and the chat intake are covered only by tests that act as the conductor.
- **Review pass 1 patches (2026-10-24).** All nine patch rows are applied.
  - `view()` now returns no `wait` when every in-flight step waits on the human and no deadline is ahead. That includes an agent step parked behind an open escalation. `budget.ts` gains `deadlinesAhead()`, and SKILL.md again ends the turn in that case.
  - `started` must carry a zone.
  - The intake brief has no `started` example and names no step id.
  - The wait loop snapshots the log size before `advance()`.
  - `budgetClock` clamps the time used to at least `clock_start`.
  - Re-verified: `node --test test/` 239/239 outside the sandbox, tsc exits 0, and the fixture shasums are unchanged.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-24): blind-hunter (B), edge-case-hunter (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| B1 | The conductor starts a 10-min background wait while only cards (gates, merge, the INTAKE chat) are in flight, so it wakes every 10 min for nothing | medium | `view()` returns `wait` whenever something is in flight, and SKILL.md dropped the "end the turn" exception. `driver.test.ts` asserts `WAIT_MAX_MS` for a claimed intake step. The matrix Wake row needs a deadline ahead for cards-only | patch: no `wait` when every in-flight step is `ask_human` and no deadline is ahead; SKILL ends the turn then |
| V1 | Re-reporting the intake after the confirm card was claimed is untested | medium (pre-verified) | The only re-report test leaves the card `issued`, so inverting the `issued` guard keeps the suite green; the real conductor always claims it | patch: test |
| V2 | The wait at a reported agent step's `overdue_at` is untested at the CLI level | medium (pre-verified) | `budget.test` passes the overdue times directly; no driver test has a reported, unverified agent step | patch: test |
| E3 | `started` with no zone is parsed as local time, which moves the clock start by the UTC offset | medium | `validateIntake` accepts any `Date.parse`-able string; `2026-10-24T14:05:00` is local | patch: require `Z` or `±hh:mm` |
| B7 | The brief's format example carries a concrete `started`, which an LLM may copy verbatim | low | `intakeBriefText` example block; the prose says to omit it. A direct correction | patch: drop `started` from the example |
| E8 | A re-reported intake step inherits a brief that names the old step id in `factory done <id>` | low | `reissueEvent` keeps `brief_path` for a role-less step; `intakeBriefText` embeds `step.id`. A direct text fix | patch: the brief names no step id |
| E7 | `next --wait` re-snapshots the log size after `advance()`, so an append in between is missed until the deadline | low | `next.ts` wait loop: `start = size()` after `advance()`. A direct reorder | patch: snapshot before advancing |
| E9 | A browser clock behind `clock_start` shows more than the limit left (`2:05 left of 2:00`) | low | `budgetClock` uses `now` unclamped. A one-line clamp | patch |
| B10 | The wake test's 1.5 s cut lead can be passed while setup still runs on a slow machine | medium | `driver.test.ts` "wake": about 11 appends plus a CLI spawn before `next` asserts `steps: []` | patch: widen the lead and bounds |
| V3/B3 | Runs still at INTAKE from before this change get no four-field confirm card | low | Their legacy card matches `isIntakeConfirm`, so approve answers it without the fields shown. It needs a pre-change run left at INTAKE, and the fix adds legacy detection | reject |
| B2 | The brief describes `ui_free`, `reviewer_overrides` and the time box, which nothing uses yet | false | By design: the frozen Never defers their use to 3-2, 3-3 and 3-4; 3-1 records them | reject |
| B4 | `cut` doesn't check that a kept slice depends on a cut one; the reducer allows ESCALATED but decide refuses it | low | Gate-2 plans are single-slice until 3-3, so no deps exist yet; the BACKLOG-only refusal is the frozen Never. The fix adds a guard; noted for 3-3/3-4 | reject |
| B5 | `done` again with an unchanged intake still reissues | low | Harmless churn; the fix adds a branch | reject |
| B6 | Validation accepts a future `started`, unknown override keys, a time box above the limit, or a limit ≤ 40 min | low | Each shows on the confirm card the human approves; the fixes add guards | reject |
| B8 | The clock mixes `h:mm` left with `+m:ss` over, and `cutLeft` can exceed a short limit | false | DESIGN.md:578 specifies `1:12` and `+m:ss over`; a limit under the cut lead is an edge the human set | reject |
| B9 | Nothing happens at `ends_at` | false | AD-17 defines only the cut and the time box as time-driven commands | reject |
| B11 | `pinOf`'s refusal says "changed since it was verified" for a reported intake | low | The message is reachable only when the human edits the file under `~/.factory`; changing it adds a parameter | reject |
| B12 | "Four fields" while `started` is a fifth | low | AD-34 names the four; `started` is an optional extra | reject |
| B13 | The harness re-implements the intake predicates more loosely; `hm` and `hmm` are duplicated | low | The harness works on `next` step views, all at INTAKE; the web bundle cannot import core (`layers.test`) | reject |
| E1/E2 | A huge `limit_min` overflows `toISOString` | low | Needs a limit beyond about 1.4e11 minutes; the fix adds a guard | reject |
| E4 | A far-past `started` spends the budget at once | low | The card shows `started`; the fix adds a guard with `now` | reject |
| E5 | A redacted projection front fails validation and stalls INTAKE | false | No redact values exist at INTAKE: `copy_gitignored` runs at SCAFFOLD | reject |
| E6 | Approve before `next` issued the confirm card says "no recorded intake" | low | Message only; the conductor prints the card before the human types | reject |

## Design Notes

- **Why the intake step is two steps.** The `ask_human` conversation step (with `output_path` and brief) lets the turn end while the human answers in chat (AD-12). The separate confirm card makes the four fields visible before `approve` (AD-34).
- **Changes after the confirm card.** A re-report reuses `step_reissued`, so the reducer gains no new transition.
- **Intake front matter example:**

```
STATUS: DONE
---
limit_min: 120
slice_timebox_min: 30
ui_free: false
reviewer_overrides: {"add": ["reviewer-security"], "remove": []}
started: "2026-10-24T14:05:00.000Z"
---
<intake notes: the task as agreed, constraints, anything the human stressed>
```

- **`reviewer_overrides`.** It applies run-wide, since no slices exist yet. Roles are `reviewer-security|ux|a11y|ui`; `reviewer-code` cannot be removed.
- **The cut card's commands.** The card lists all candidates, but `cut` may name any subset of them.

## Verification

**Commands:**
- `node --test test/` -- expected: all pass.
- `npm i --prefix "$TMPDIR/tsc" --cache "$TMPDIR/npm-cache" typescript@7.0.2 @types/node@22 && "$TMPDIR/tsc/node_modules/.bin/tsc" -p tsconfig.json --typeRoots "$TMPDIR/tsc/node_modules/@types"` -- expected: exit 0.
- `shasum test/fixtures/*.state.json` before/after -- expected: identical.
- `npm ci --prefix src/dashboard/web --cache "$TMPDIR/npm-cache" && npm run --prefix src/dashboard/web build` -- expected: exit 0, and the web-build test passes.

**Manual checks:**
- Take a Playwright screenshot at 1440×900 of a lane with the cut card open and one past 0:00. Compare it with `mockups/key-dashboard.html`, States 03.
