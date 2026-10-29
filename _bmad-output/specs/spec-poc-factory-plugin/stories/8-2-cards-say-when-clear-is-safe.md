---
title: 'Cards say when /clear is safe'
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: 'ec77d07eaf0f53450e865e0a926f37a8f3839eac'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** At a card the human cannot tell whether `/clear` would lose anything: a background agent, check or `--wait` may still be running (dry run 3 finding 2; CAP-1, AD-34).

**Approach:** Apply `sprint-change-proposal-2026-10-28.md` section 4.3 (contract docs already edited). `next` stores `Card.clear_safe: true` on an ask_human card it issues into a parked run (`isParked`, AD-12), except the merge card. `cardLines` and the Needs You card end with one line from that flag, shown only while the run is still parked.

**Decisions (review pass 1, 2026-10-29):**
- **No deadline ahead.** The flag also requires that `next` would not hand the conductor a `wait`: no BUILD cut point, live-slice time box or overdue claim ahead (`deadlinesAhead`). `/clear` must never kill a sleeping `next --wait`.
- **Sole open card.** The flag also requires that the card is the only open ask_human step with commands, so a ruling on another card cannot restart work under a line already printed in chat. The INTAKE conversation step has no commands, so the intake confirm card still qualifies.

## Boundaries & Constraints

**Always:**
- The line is exactly ``Safe to `/clear` here: the run is saved. After clearing, type one of the commands above.`` and comes after the reply.
- `clear_safe` is additive within `v:1` with no upcaster (AD-32). A card without it renders exactly as today, so the golden timelines stay byte-identical.
- Chat (`card_text`) and board (Needs You) show the line under the same rule: stored `clear_safe` and the run parked now.
- The merge card and the INTAKE conversation card (no commands) never carry it. The intake confirm card does.

**Never:**
- Computing the line from `isParked` alone at view time (old recordings would gain it).
- Any new event kind, decision or settings read.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Gate 1 / Gate 2 / intake confirm | Card issued, every other open step waits on the human | Stored `clear_safe: true`; `card_text` and Needs You end with the line. |
| Escalation while another slice works | E1 raised while slice B's reviewer is claimed | Stored without the flag; no line, also after B parks later. |
| Run unparks under an open card | E2 stored `true`; ruling E1 spawns a builder | E2 shows no line until the run parks again. |
| Merge card | WRAP merge card in a parked run | Never stored, never shown. |
| Deadline ahead | Parked at a BUILD escalation with the cut point or a time box ahead | Not stored; no line. |
| Two open cards | Parked, E1 open, E2 issued | E2 stored without the flag; no line on either. |
| Card issued with a spawn | One `next` issues a card and a spawn | Not stored; no line. |
| Old recording | Cards with no `clear_safe` | No line; timelines unchanged. |

</frozen-after-approval>

## Code Map

- `src/core/events.ts:40` `Card`: add `clear_safe?: boolean` with an "8-2 (AD-34), additive" comment. Validation is hand-written and needs no change.
- `src/core/cards.ts:27` `cardLines`: append `CLEAR_SAFE_LINE` (exported) when `card.clear_safe`, after the reply, for both the options and old commands-only shapes. Add `clearSafeNow(card, parked): Card` returning the card without `clear_safe` unless `parked` (same object when the flag is absent).
- `src/cli/next.ts:556` `issueDue`: today gates and appends each `step_issued` in turn. Collect the events, gate them in order as now, then if `isParked` (from `../core/verify.ts`) of the final state, set `card.clear_safe = true` on each issued `ask_human` card whose type is not `merge` and whose `commands` is non-empty; then append all and return the state gated from the input state with the final events. Parked is judged after the whole batch so a spawn issued alongside a card blocks the flag.
- `src/cli/commit.ts:43` `stepView`: use `clearSafeNow(st.card, state ? isParked(state) : false)` for both `card` and `card_text`. `src/cli/status.ts:30` passes `state` too.
- `src/core/projection.ts:278-289` Needs You: gate/merge entries use `st.card`; ask entries use `a.card` plus the flag from the open ask_human step that carries the ask (export `carries` from `src/core/schedule.ts:264`). Pass every entry's card through `clearSafeNow(card, parked)`.
- `src/dashboard/web/src/lib/types.ts:11` mirror `clear_safe?`. `lib/model.ts` `actionRows` returns `clear?: string` (a mirrored `CLEAR_SAFE_LINE`; web never imports core). `components/ActionSlot.svelte` renders it after the reply, styled like `.reply`; widen its `Pick` with `clear_safe`. Rebuild `dashboard/dist`.
- Tests: `test/cards.test.ts` (cardLines), `test/driver.test.ts:238` (the intake confirm `card_text` gains the line), `test/pipeline.test.ts` (gate 1 at :176, gate 2 at :1639, escalations, merge), `test/web-model.test.ts:263` (actionRows), `test/timeline.test.ts` (goldens unchanged).

## Tasks & Acceptance

**Execution:**
- [x] `src/core/events.ts`, `src/core/cards.ts` -- add the field, `CLEAR_SAFE_LINE`, the `cardLines` line and `clearSafeNow` -- single source of the text and rule.
- [x] `src/cli/next.ts` -- `issueDue` stores the flag as in the Code Map -- `next` decides once, at issue.
- [x] `src/cli/commit.ts`, `src/cli/status.ts` -- `stepView` hides a stale flag -- chat matches board.
- [x] `src/core/schedule.ts`, `src/core/projection.ts` -- Needs You cards carry the gated flag -- board line.
- [x] `src/dashboard/web/src/{lib/types.ts,lib/model.ts,components/ActionSlot.svelte}`, then `cd src/dashboard/web && npm run build` -- render the line -- same text on the board.
- [x] Tests -- one per matrix row, plus `actionRows` with and without the flag and a `cardLines` unit test.

**Acceptance Criteria:**
- Given a run parked at gate 1 or gate 2, when `next` returns the card, then `card_text` ends with the line and the board's Needs You card shows it.
- Given an escalation raised while another slice's reviewer is claimed, when `next` returns it, then neither chat nor board shows the line.
- Given a WRAP merge card, when it is shown anywhere, then the line is absent.
- Given the committed recordings, when `node --test test/timeline.test.ts` runs, then the timelines are unchanged.

## Design Notes

Stored, not computed: the spine says `next` sets it and old recordings render without it, and the goldens already hold parked gate frames, so a view-time `isParked` would change them. Gated by "parked now" too, because a stored `true` goes stale when a ruling on another card restarts work while this card stays open, and the line would then tell the human to `/clear` over a running agent. The cost is one missed line: a card stored without the flag stays without it after the run later parks.

## Implementation Notes

- **The rule as built.** `issueDue` (`src/cli/next.ts`) gathers the batch, then stores `clear_safe` only when the run is parked, exactly one open ask_human step has commands, and `waitDeadlines` (shared with `view`) finds nothing ahead. It gates the batch, then appends it. Views (`stepView`, Needs You) pass the card through `clearSafeNow(card, isParked)`.
- **Batch order not singled out.** No test can isolate "judged after the batch": in BUILD, the only place a card and an agent step come out of one `next`, a live time box is always ahead, so the deadline rule also blocks the flag.
- **Board.** `ActionSlot` renders the backticked `/clear` as inline `<code>`, and `dashboard/dist` is rebuilt.
- **Tests.** Two new pipeline tests: a card issued with a builder `resume`, and parked at a BUILD escalation with the cut point ahead, then a second open card. `status` checks at gate 1. Verification: the spec's test files plus `projection` and `web-build` gave 203/203, with goldens unchanged.
- **Review.** Pass 1 found two intent gaps, which the human settled by amending rather than reverting, plus five patches. All are applied. The human skipped pass 2 on the amended code (2026-10-29).

## Spec Change Log

- **Pass 1 intent gaps (2026-10-29).** Triggered by: parked while a `--wait` sleeps, and chat cannot take the line back (see Review Triage Log). The human chose "no deadline ahead" and "sole open card", and chose to keep the code and amend it rather than revert. Amended: the frozen Decisions and three matrix rows. Code: `issueDue` stores the flag only when, after the batch, the run is parked, `deadlinesAhead` is empty (computed as `view` does: extract one helper both use), and exactly one open ask_human step has commands. Views keep `clearSafeNow(card, isParked)`. Avoids: a line that claims safety over a sleeping `--wait`, or over a sibling card whose ruling restarts work. KEEP: the stored flag plus `clearSafeNow`, the single `CLEAR_SAFE_LINE`, the web mirror and its equality test, and every existing 8-2 test.

## Review Triage Log

Pass 1: Blind Hunter, Edge Case Hunter, Verification Gap.

**Intent gaps (loopback):**
- **Parked while a `--wait` sleeps (blind + edge, medium).** `view()` returns `wait` when only cards are open but a deadline is ahead: the BUILD cut point, a live slice's time box or an overdue claim (`next.ts` `view`, `budget.ts:48` `deadlinesAhead`). The conductor then runs a background `next --wait` (SKILL.md loop). `isParked` is true, so the card says `/clear` is safe and `/clear` kills that wait. Nothing on disk is lost, but the deadline card (cut, Over time box) is raised only when the human next types a command. The frozen rule names `isParked`, while the Problem names `--wait`.
- **Chat cannot take the line back (edge, medium).** The conductor claims an `ask_human` step and prints its `card_text` once (SKILL.md), so `stepView`'s stale-flag hiding only reaches `status`. With E1 and E2 both open and parked, E2 is printed with the line. Ruling E1 then spawns a builder, and E2's printed line stays in chat while the board hides it. This breaks "chat and board show the line under the same rule".

**Patch (moot until the loopback; re-apply after):**
- **Weakened cut assertion (blind, low).** `pipeline.test.ts:1587` adds `clear_safe` to the ask card before comparing, so it no longer proves the ask card lacks it. Fix: assert `'clear_safe' in raised.data.card` is false.
- **Append before the final gate (edge, low).** `issueDue` appends, then calls `gateOrThrow(state, final)`. Fix: gate first, then append.
- **Literal backticks on the board (blind, low).** `ActionSlot` prints `{clear}` as text, so the board shows `` `/clear` `` with its backticks on every parked gate. Fix: render the backticked part as `<code>`.
- **Mixed batch untested (verification gap, medium).** No test issues a card and a spawn in one `next`. A mutation that judges parked per event passed all 116 tests. Fix: a pipeline case where an escalation card and a spawn share one `next`.
- **`stepView`/`status` untested (verification gap + blind, medium).** No test reads `status`'s `card` or `card_text`, and none hits `stepView` with a stale flag. Fix: `status` assertions while parked at gate 1 and after work restarts.

**Deferred:**
- **"No line after B parks later" untested end-to-end (verification gap, medium).** Only the board half is pinned (`projection.test.ts`).

**Rejected:**
- **`view()` duplicates the parked rule (blind, low).** `cardsOnly` predates this story, and no caller diverges today.
- **`stepView`'s optional `state` (blind, low).** Both callers pass it now.
- **Orphan briefs on a throw mid-batch (blind + edge, low).** Before this change the failing step's brief was orphaned too. It is rare, and the fix adds a catch.
- **No `ActionSlot` render test or dist in the diff (blind, low).** `actionRows` is tested, `dist` was rebuilt, and the bundle is byte-identical after the comment fix.
- **projection imports `carries` from schedule (blind, low).** `layers.test.ts` passes, and no harm is named.
- **Implicit intake exclusion and `commands` maybe missing (blind, false).** `Card.commands` is required, and `due()` always sets it. `cardLines`' `?? []` is only for old recordings.
- **A card issued while work ran never gains the line (blind + edge, false).** This is chosen in the frozen matrix (row 2).

## Verification

**Commands:**
- `node --test test/cards.test.ts test/driver.test.ts test/pipeline.test.ts test/web-model.test.ts test/timeline.test.ts test/dashboard.test.ts` -- expected: all pass, goldens unchanged.
- `cd src/dashboard/web && npm run build` -- expected: `dashboard/dist` updated.
