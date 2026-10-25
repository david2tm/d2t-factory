---
title: "Cards that say what's next; intake task and scope; optional time limit"
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_commit: '27afef74e4f6e2b9fa37e702323e1c9a92d983ff'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In dry run 1, cards didn't say what to type, what happens after it, or what a chat reply does (finding 3). The intake confirm card showed four settings but not the task and scope the human agreed (finding 4). The time limit was mandatory and worded as "the whole exercise" (finding 2; CAP-2, CAP-11).

**Approach:** AD-34 cards gain optional `details[]`, `options[{command, then}]` and `reply`, and `commands` is derived from `options`. All of this lives in `cards.ts`, and the conductor and the Needs You card both show it in one order. The intake (AD-27) gains a required `task` and `scope{in, out}`, and `limit_min` becomes optional. Without a limit there is no budget clock and no cut, and the lane shows `ELAPSED h:mm · no limit` (AD-17). Everything is additive within `v:1`.

## Boundaries & Constraints

**Always:**
- **Card order** (chat and board): title, reason, details, `To continue, type one of:`, then one `command — then` per option, then the reply line. A card without `options` (old recordings) falls back to `commands`, with no `then`.
- **`then` and `reply` text** comes from the proposal's table 4.2, adapted to what the code really does:
  - **Intake confirm.** `approve intake — RECON maps the repo, then SCAFFOLD; the next stop is Gate 1`, with `FRAME picks the stack` on greenfield. Reply: `Reply in chat to change any of this; you'll get this card again.`
  - **Gate 1.** Rework says `SPEC and DESIGN are redone with your note` only when there is a design. Reply: `Ask questions in chat; to change the spec (or design), use rework.`
  - **Gate 2.** `approve` says `unless an escalation or the cut point comes first`, and drops the cut point when the run has no limit.
  - **Merge.** `merge — the CLI merges the run branch into <branch> locally and the run ends`. Each `rework S<n>` sends that slice back to its builder and reviewers, and the card comes back. `abandon — the run ends; nothing is merged`.
  - **Design choice.** The default option keeps `design.md` as written. The other option has a fresh designer write it. Both go on to Gate 1.
  - **Escalation cards** (escalation, step and slice non-convergence, over time box, new dependency, SCAFFOLD failure, cut). Each command gets the `then` that matches its comment in `cards.ts`. Reply: `Ask in chat; to decide, type one of the commands.`
  - **Decided:** the cut card gets this reply as well, so every card printed in chat has a reply line.
  - **Exceptions:** `signal_lost` (board-only) gets options but no reply. The intake conversation card (no commands) gets only a reply: `Answer in chat; you'll then get a card to confirm the intake.`
- **Redaction.** `redactCard` also redacts `details`, each `then` and `reply`.
- **Intake validation.**
  - `task` is required, as a non-empty single-line string.
  - `scope` is required, as `{in: string[], out: string[]}`. Either list may be empty.
  - `limit_min` may be left out or null. If present, it is a whole number above 0.
  - `started` with no `limit_min` is refused.
  - Intake confirm card:
    - reason: `time limit 2:00` or `no time limit` · `slice time box 30 min` · `UI-free no` · `reviewers: default`, plus `· started <iso>` when set;
    - details: `Task: …`, `In scope: a; b`, `Out of scope: …`. An empty list shows `—`.
- **No limit.**
  - `budgetOf` stays null, so there are no cut candidates, no cut deadline and no `cut_at`/`ends_at` deadlines.
  - The projection's `budget` is `{clock_start, limit_min: null, cut_at: null, ends_at: null, stopped_at}`.
  - Runs with a limit keep the same key order and values, so the recordings fold byte-identical.
  - The board shows `ELAPSED 0:47 · no limit`, using whole minutes as `h:mm`. It counts up from `clock_start` and stops at `stopped_at`. There is no meter and no caption.
- **Wording.** No "exercise" or "interview" in the brief, the cards or code comments. Use `time limit` instead.

**Never:** no new route, process, dependency or event kind. Don't change `mayStop`, AD-6 decision parsing, what any command does, or the stored events of existing recordings. Don't touch 6-3 (claim waiting states, artifact drawer) or 6-4 (SCAFFOLD repair, its reason text).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Intake, no limit | front matter without `limit_min` | valid; card `no time limit`; `clock_start` = run start; never a cut card |
| `started` alone | `started` set, no `limit_min` | MISSING_EVIDENCE: started needs limit_min |
| Missing task/scope | no `task`, or `scope` not `{in[], out[]}` | MISSING_EVIDENCE naming the field |
| Every card function | any inputs | `commands` deep-equals `options.map(o => o.command)`; every option has a non-empty `then` |
| Old card | stored card with only `commands` | board lists commands, no then lines, no reply; chat text = old shape |
| Limit run fold | fixture recordings | timeline snapshots byte-identical |

</frozen-after-approval>

## Code Map

- `src/core/events.ts` -- `Card` (add `details?`, `options?`, `reply?`; `CardOption` type), `Intake` (`task`, `scope`, `limit_min?`); comment wording at line 65.
- `src/core/cards.ts` -- every card function gets options/reply; a helper like `withOptions(opts)` returning `{options, commands}`; add pure `cardLines(card): string[]` (the AD-34 chat order, old-card fallback). `intakeConfirmCard(i, {greenfield})`, `gate2Card` gets `cut: boolean` (run has a limit). Leave `scaffoldFailureCard`'s reason as is (6-4 owns it).
- `src/core/schedule.ts:59-143` -- callers of intake/gate1/gate2/design/merge cards; pass `greenfield` (state.greenfield) and `cut` (`state.intake?.limit_min` set).
- `src/cli/next.ts` (cut, over time box, non-convergence, new dependency, scaffold failure raisers) -- call sites only; signatures stay unless needed.
- `src/cli/steps.ts:68` `redactCard` -- also redact `details`, `options[].then`, `reply`.
- `src/cli/commit.ts:40` `stepView` -- for an `ask_human` step with a card, add `card_text: cardLines(card).join('\n')` to the `next` JSON (CLI output only, not event data) so the conductor prints it verbatim.
- `skills/factory/SKILL.md:31-32` -- intake: "task, scope and settings" not "four fields"; any other ask_human: print `card_text` verbatim as the last lines.
- `src/core/artifacts.ts:60-92` `validateIntake` -- rules above; keep error style.
- `src/cli/brief.ts:313-335` `intakeBriefText` -- add `task`, `scope` bullets; `limit_min` optional (proposal 4.1 wording), `started` only with a limit; output format example adds `task: "…"` and `scope: {"in": [...], "out": [...]}`; "the four fields" → the task, scope and settings.
- `src/core/budget.ts:16` comment wording; `budgetOf` already null without a limit -- keep.
- `src/core/projection.ts:67,308,322` -- `BudgetView` with nullable `limit_min`/`cut_at`/`ends_at`; no-limit branch from `s.clock_start`.
- `src/dashboard/web/src/lib/types.ts` -- mirror `Card` and `BudgetView`.
- `src/dashboard/web/src/lib/model.ts:300-345` -- `budgetClock` returns null when `limit_min` is null; add `elapsedClock(b, now)`.
- `src/dashboard/web/src/components/BudgetClock.svelte` -- elapsed variant (glyph, `ELAPSED`, readout, text-3 `· no limit`, aria-label).
- `src/dashboard/web/src/components/NeedsCard.svelte`, `ActionSlot.svelte` -- details lines after the reason; ActionSlot takes `options` (fallback from `commands`) and `reply`; `then` below each row (body-sm, needs-text-3), reply at the bottom (body-sm, text-3). Rebuild `dashboard/dist` the way `test/web-build.test.ts` expects.
- `test/harness.ts:199` `intakeOut` -- default `task` and `scope` so existing pipeline tests keep passing.
- Tests: `cards.test.ts`, `artifacts.test.ts`, `budget.test.ts`, `projection.test.ts`, `schedule.test.ts`, `web-model.test.ts`, plus whatever asserts old card shapes.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/events.ts`, `src/dashboard/web/src/lib/types.ts` -- types.
- [x] `src/core/artifacts.ts`, `src/cli/brief.ts`, `src/core/budget.ts` -- intake schema, brief, wording.
- [x] `src/core/cards.ts`, `src/core/schedule.ts`, `src/cli/next.ts`, `src/cli/steps.ts`, `src/cli/commit.ts` -- options, reply, details, `cardLines`, `card_text`, redaction.
- [x] `skills/factory/SKILL.md` -- print `card_text`; intake wording.
- [x] `src/core/projection.ts`, web `model.ts`, `BudgetClock.svelte`, `NeedsCard.svelte`, `ActionSlot.svelte`, `dashboard/dist` -- elapsed clock, options rendering.
- [x] `test/*` -- every matrix row; one test per card function that options and commands agree; `cardLines` order and old-card fallback; no-limit projection and `elapsedClock` (counts, stops at stopped_at); intake card details.

**Acceptance Criteria:**
- Given the full suite, when run, then it passes, with `web-build` passing and every recording timeline fixture unchanged.
- Given a no-limit run through the pipeline harness, when it reaches BUILD past what would be the cut point, then no cut card is raised and the lane's budget has `limit_min: null`.
- Given `rg -i 'exercise|interview' src skills agents`, when run, then nothing matches.

## Implementation Notes

- The five `test/fixtures/recordings/*.timeline.json` snapshots changed in one line each: the `runs` header's `signal_lost_card`, which is built fresh from `signalLostCard()` at replay time and now carries `options`. Every `events` and `frames` line (the fold of the recorded events) is byte-identical. Deliberate (AD-32 allows a noted change).
- Reply wording per card: Gate 1 `…to change the spec or design…` (with a design) / `the spec`; Gate 2 `the plan`; merge `a slice`; design choice uses the escalation reply.
- `Intake.task`/`scope` are optional in the type (pre-6-2 recorded intakes lack them); a validated intake always has them.
- `card_text` also appears in `factory status` output (shared `stepView`).
- No `tsc`/`svelte-check` is installed; checking is the suite plus the Vite build (`web-build`).

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-25: blind-hunter, edge-case-hunter, verification-gap).

| # | Source | Finding | Verdict | Evidence / route |
|---|---|---|---|---|
| 1 | blind | Intake confirm card never shows on the board, so `details` never render there | false | By design: EXPERIENCE INTAKE row says "No Needs You card — d2t is already in the conversation"; `projection.ts:227` skips intake. Rejected |
| 2 | blind | Agreed task/scope never reach later agents (briefs use `state.task`) | medium | Real, pre-existing: no intake content reached agents before 6-2 either; the intent asks only that the card shows them → defer |
| 3 | blind, edge | Scope items may be empty, whitespace or contain a newline; not trimmed | low | `validateIntake` checks only `isStrList`; a JSON `"\n"` breaks `card_text`'s one-string-per-line. Direct correction → patch |
| 4 | edge | Task with U+2028/U+0085 renders as several lines | low | Needs a conductor writing exotic separators; adds a rule. Rejected |
| 5 | blind, edge | `then` says "the next stop is Gate 1" though an escalation or design question may come first | low | Wording is the frozen, d2t-approved table 4.2 text; the fix edits the spec. Rejected |
| 6 | blind | Over time box `cut` then line doesn't say the commits are merged with the run branch | low | Ambiguity, not a false statement; text mirrors the card's own comment. Rejected |
| 7 | blind | Brief's format example still shows `limit_min: 120` | low | The line after it says to leave `limit_min` out with no limit, and the bullet asks whether there is one. Rejected |
| 8 | blind | Old card's `card_text` adds `To continue, type one of:` and indents, contradicting matrix row "chat text = old shape" | low | `cardLines` fallback differs from the pre-6-2 print (title, reason, each command). Direct correction → patch |
| 9 | blind, edge (claim) | Timeline fixtures changed despite AC "unchanged" | low | Only the replay-built `signal_lost_card` header gained `options`; every `events`/`frames` line is byte-identical; noted in Implementation Notes. Fix edits the spec → rejected; surfaced to d2t |
| 10 | blind | Checklist ticks `src/cli/next.ts`, which the diff doesn't touch | low | Its call sites needed no change. Fix edits the spec → rejected |
| 11 | verification-gap, blind | `redactCard`'s new `details`/`then`/`reply` redaction is untested | medium | Pre-verified gap: no test calls `redactCard` with a secret in those fields → patch (unit test) |
| 12 | verification-gap, blind | Board rendering of options/then/reply and the old-card fallback is untested | medium | Pre-verified gap: row logic lives in `ActionSlot.svelte`, no render tests → patch (pure `actionRows` in `model.ts` + `web-model.test.ts`) |
| 13 | blind | `Lane.svelte:55` comment still says "The Budget clock" only | low | Stale comment, one-line fix → patch |
| 14 | blind | Intake conversation card's reason is conductor-addressed beside a human reply; SKILL brief_path branch doesn't mention `card_text` | low | That card is never printed in chat nor on the board (intake skipped). Rejected |
| 15 | edge | Pre-6-2 in-flight intake without task/scope stalls (no confirm card) or approve is refused | low | Only runs straddling the upgrade; none exist (dry-run state deleted). Adds branches. Rejected |
| 16 | edge | Projection reports `limit_min: null` when a limit exists but `clock_start` doesn't parse | false | `clock_start` is always written by `clockStart()` as an ISO string (`decide.ts:92`). Rejected |
| 17 | edge | `budgetClock` with `undefined` (not null) fields yields NaN | false | The projection always emits the five keys with null; JSON keeps null. Rejected |
| 18 | edge (claim) | Chat and board renderings differ (reason_label, plates, no "To continue") | false | The board form is DESIGN's Action slot (`> RESPOND IN TERMINAL`, REASON label); the same content, per surface. Rejected |
| 19 | edge (claim) | Required task/scope isn't "additive within v:1" | low | Event schema is unchanged and old events fold; only new intake files must carry the fields. Same as row 15. Rejected |

## Design Notes

`card_text` is computed from the stored card at view time, so the chat text and the board both come from the one card object. "Verbatim" then means one string, and the conductor doesn't have to assemble it. Example (intake confirm):

```
Intake — confirm the task
time limit 2:00 · slice time box 30 min · UI-free no · reviewers: default
Task: add an optional task giver to each todo
In scope: a giver field on add and edit; shown on the todo card
Out of scope: filtering or sorting by giver
To continue, type one of:
  /factory approve intake — RECON maps the repo, then SCAFFOLD; the next stop is Gate 1
Reply in chat to change any of this; you'll get this card again.
```

The elapsed readout uses `h:mm` to match `BUDGET 1:12` and `time limit 2:00`. EXPERIENCE's `m:ss` and its example `0:47` both read as minutes.

## Verification

**Commands:**
- `node --test test/*.test.ts` -- expected: all pass.
- `rg -i 'exercise|interview' src skills agents` -- expected: no output.
