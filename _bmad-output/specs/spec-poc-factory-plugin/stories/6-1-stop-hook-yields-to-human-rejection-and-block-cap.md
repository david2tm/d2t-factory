---
title: 'Stop hook yields to a human rejection; factory-owned block cap'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_commit: '9b3d537a9c083b754c8659f78e3b522d2746a52b'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In dry run 1 the human rejected `factory done`, and the Stop hook then blocked every stop until Claude Code's own 8-continuation cap overrode it, silently and unrecorded (finding 9, CAP-14).

**Approach:** Two narrow, recorded exits in the Stop hook, both decided by the factory. (1) The stop passes when the session's own transcript holds a human-rejected tool use after the turn's last human prompt that is still the conductor's latest tool use (`stop_yielded`). (2) After `STOP_BLOCK_MAX` (3) consecutive blocks, the next stop passes (`stop_forced`). Both show as a dashboard-only PAUSED lane notice.

**Spike (done at planning).** Local transcripts (Claude Code 2.1.301–2.1.310) carry a structured record on the `type: "user"` tool_result entry: a human rejection has `toolDenialKind: "user-rejected"` and `permissionDecision: {decision: "reject", source: "user_reject"}`. Hook denials (the factory guard) and built-in safety checks have `toolDenialKind: "permission-rule"` with `source: "hook"` / `"config"`. The rejection exit ships; no `tool_requested` fact.

## Boundaries & Constraints

**Always:**
- Order inside `stop()`: unbound / non-holder / terminal pass (unchanged) → `mayStop` allows (pass, count reset) → human rejection (pass) → block cap → block.
- **Rejection match.** Scan the transcript from the end back to the last entry with `type: "user"`, `turnOrigin: "human"`, `isMeta` not true. A match is an entry after it with `type: "user"`, `isSidechain` not true, `sessionId` equal to the session, `toolDenialKind === "user-rejected"`, `permissionDecision.decision === "reject"`, `permissionDecision.source === "user_reject"`, and a `tool_result` content block with `is_error: true` and a string `tool_use_id`. **Decided at review (2026-10-25):** the match counts only while no main-thread tool use follows it, i.e. no later entry with `type: "assistant"`, `isSidechain` not true and a `tool_use` content block. Once the conductor calls a tool again (with the human's feedback, or in a turn a task notification started), the rejection is spent and the Stop rules apply again. Never a substring match. Transcript located only via `locateTranscript` (AD-6); missing transcript means no rejection.
- **Counter file** `sessions/<session>.stop` (JSON): `{blocks, tool_fact, human_turn, yielded}`. `tool_fact` is the id of the newest `tool_succeeded`/`tool_failed`/`output_written` in `facts/<session>-main.jsonl`; `human_turn` is the `uuid` of the last human transcript entry. If either differs from what the file recorded, `blocks` resets to 0 before counting. An allowed stop (any exit) also resets it.
- **Cap.** With `blocks >= STOP_BLOCK_MAX` the stop passes and appends `stop_forced{blocks, reason}` (reason = the `mayStop` reason). Otherwise `blocks += 1` and the block is returned as today.
- `stop_yielded{reason: 'human_rejected', tool_use_id}` is appended once per `tool_use_id` (dedupe via `yielded`); later stops in the same situation still pass, silently.
- Both are new fact kinds, additive within `v:1`, written through `appendFact` (redacted, validated) to the session's main facts file.
- **PAUSED.** Projection adds `paused: {reason: 'human_rejected' | 'block_cap', at, blocks?}` only while the newest stop fact is newer than every command and every main-agent (no `agent_id`) tool fact of that session, and the run is not terminal. The field is omitted otherwise, so existing recordings fold byte-identical.
- Lane header shows `PAUSED · you rejected a tool call 15:24` or `PAUSED · the conductor stopped after 3 blocks 15:24` (local `clockTime`) in text-2 beside the stage.

**Never:**
- No change to `mayStop`'s rules, the guard, CAP-10's closed list, or any chat prompt.
- No transcript path from a payload or fact. No new route, process or dependency.
- Nothing may rely on Stop firing after a user interrupt.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Human rejection | Holder, working, pinned fixture after last human turn | Pass; one `stop_yielded`; a second stop passes, no second fact |
| Echoed string | Assistant text or a tool_result string containing the rejection message | Block |
| Deny rule / guard | `permission-rule` record after last human turn | Block |
| Rejection before last human turn | Rejection, then a new human prompt | Block (counted) |
| Rejection, then the conductor works on | Rejection (with feedback, or then a task-notification turn), then an assistant `tool_use` | Block (counted); no new `stop_yielded` |
| Rejection, notification turn, text only | Rejection, then a non-human turn with text only | Pass; still the one `stop_yielded`; PAUSED still shown |
| Fourth text-only stop | 3 blocks, no tool fact, no new human turn | 4th passes; `stop_forced{blocks: 3}`; 5th blocks again (count 1) |
| Tool call between | Block, block, new main tool fact, block, block | All four block |
| Human prompt / interrupt | 2 blocks, (interrupt: no Stop), new human transcript turn | Next stop blocks with count 1 |
| Unbound / non-holder / terminal | — | Pass, no fact, no counter written |

</frozen-after-approval>

## Code Map

- `src/hooks/stop.ts` -- the only hook change: counter, transcript check, facts.
- `src/core/stop.ts` -- add pure `humanRejection(lines, session): string | null` and `lastHumanTurn(lines): string | null` beside `mayStop`.
- `src/store/sessions.ts` -- `locateTranscript` / `readTranscript` already live in store (AD-6 move is done); add `readStopFile` / `writeStopFile` here (atomic write like the session file).
- `src/store/paths.ts` -- add `stopFile(session)` next to `sessionFile`.
- `src/core/config.ts` -- `STOP_BLOCK_MAX = 3`.
- `src/core/events.ts` -- `stop_yielded`, `stop_forced` in `FACT_KINDS`, `DataByKind`, `REQUIRED`.
- `src/core/projection.ts` + `src/dashboard/web/src/lib/types.ts` -- `Lane.paused?`.
- `src/dashboard/web/src/lib/model.ts` + `components/Lane.svelte` -- `pausedNotice(lane)` text; render; rebuild `dashboard/dist`.
- Fixture sources (read-only, user's own transcripts; copy one line each, keep every key and the ids/structure, replace `toolUseResult`, `userFeedback`, tool_result `content`, `cwd`, `gitBranch` with neutral text, and rewrite `sessionId`/`session_id` to the test session): human rejection = the line with `"source":"user_reject"` in `~/.claude/projects/-Users-d2t-Projects-empty/92335895-8e0b-4eab-83de-18fdc8896a34.jsonl` (v2.1.310); guard deny = the line with `"reasonCode":"hook:PreToolUse"` in `~/.claude/projects/-Users-d2t-Projects-d2t-factory-spikes--work-repo-07-fact-completeness-sandbox-off/0d451dca-197e-4193-856b-fa87bedb583d.jsonl`. Human turns are `type: user` + `turnOrigin: "human"`; Stop-hook feedback lines are `type: user` + `isMeta: true` with no `turnOrigin`; `api-request-blob` lines repeat tool_result content without the denial fields.
- `test/hooks.test.ts` -- existing Stop test blocks four times in a row; it now needs the count reset its allowed stop provides (verify it still passes as is).

## Tasks & Acceptance

**Execution:**
- [x] `test/fixtures/transcripts/` -- pin sanitized real records: `user-rejected.jsonl` (2.1.310 shape) and `permission-rule.jsonl` (guard hook deny), keeping every key, replacing personal text.
- [x] `src/core/events.ts`, `src/core/config.ts`, `src/store/paths.ts`, `src/store/sessions.ts` -- kinds, constant, stop file I/O.
- [x] `src/core/stop.ts` -- the two pure readers.
- [x] `src/hooks/stop.ts` -- the decision order above.
- [x] `src/core/projection.ts`, web `types.ts`, `model.ts`, `Lane.svelte`, `dashboard/dist` -- PAUSED.
- [x] `test/stop.test.ts`, `test/hooks.test.ts`, `test/projection.test.ts`, `test/web-model.test.ts` -- every matrix row; PAUSED appears and clears on a later command or main tool fact; recordings fold unchanged.

**Acceptance Criteria:**
- Given the full suite, when run, then it passes, including `web-build` and the recording timeline fixtures unchanged.
- Given a run paused by either exit, when the conductor's next command or tool call lands, then the lane notice is gone.

## Spec Change Log

- **Loop 1 (2026-10-25), triage rows 1–3, intent_gap resolved by d2t.** Trigger: a rejection stayed valid until the next human prompt, so with feedback or after a task-notification turn the conductor could stop mid-work, and repeat yields after a tool fact had cleared PAUSED left no notice. Amended (frozen, by d2t's answer): the rejection counts only while no main-thread `tool_use` follows it; two matrix rows added. Known-bad state avoided: silent unenforced stops with no PAUSED. Route: d2t chose to patch the existing code instead of revert and re-derive. KEEP: everything else in the implementation (decision order, id-based resets, counter file, dedupe, projection, notice, fixtures and tests).

## Review Triage Log

Pass 1 (2026-10-25: blind-hunter, edge-case-hunter, verification-gap).

| # | Source | Finding | Verdict | Evidence / route |
|---|---|---|---|---|
| 1 | blind | A rejection with feedback keeps the turn going; later stops pass even after more conductor tool calls | medium | `humanRejection` bounds only at the last human turn; feedback makes the model keep working. Root cause A → intent_gap |
| 2 | edge | A task-notification turn after an old rejection still yields until the human types | medium | Same bound (only `turnOrigin: human` ends it). Root cause A → intent_gap |
| 3 | edge (+claim) | Repeat yields for an already-recorded tool_use_id leave no fact; after a tool fact clears PAUSED the conductor stops with no notice | high | `stop.ts` dedupes on `yielded`; `pausedOf` clears on the tool fact. Breaks "both exits show PAUSED". Root cause A → intent_gap |
| 4 | blind, edge | Transcript/facts read or `appendFact` throwing fails open without a record (counter can stick at 3) | low | Needs an fs failure on files the hook just located; pre-existing for `loadCommands`. Fix adds guards → rejected |
| 5 | blind | `.stop` file never deleted with the session file | low | `deleteSessionFile` removes only `.json`; direct one-line fix → patch |
| 6 | blind | PAUSED clears at once if the rejected tool yields a `tool_failed` fact | false | A manual denial fires neither PostToolUse nor PostToolUseFailure (proposal 4.6, hooks reference) |
| 7 | blind | A human chat reply doesn't clear PAUSED | low | Spec/EXPERIENCE: clears on the run's next command; the conductor's reply action clears it. Rejected |
| 8 | blind | `TOOL_FACTS` defined twice (hook counter vs projection clear) | low | Divergence would desync counter reset and PAUSED clear; direct fix (one export in events.ts) → patch |
| 9 | blind | `stop_yielded.reason` value not validated | low | Only one reason exists; no reachable harm. Rejected |
| 10 | blind, edge | Whole transcript parsed per blocked stop | low | Only when blocking; multi-MB parse is well under the hook timeout. Tail reading adds complexity. Rejected |
| 11 | blind | Missing tests: readStopFile malformed, two-session pausedOf, notice without blocks | low | Defensive paths, not reached in practice. Rejected |
| 12 | blind | PAUSED not announced via aria-live; may overflow | low | SIGNAL LOST (same dashboard-only class) isn't announced either; `h2` ellipsizes (min-width 0). Rejected |
| 13 | edge | No `turnOrigin` (older Claude Code) makes the whole transcript one turn | low | All local transcripts 2.1.301+ carry it. Rejected |
| 14 | edge (+claim) | After /clear the rebound session's tool facts don't clear PAUSED | false | The new session's first holder verb appends `session_bound` (a command), which clears it |
| 15 | edge | `yielded` grows without bound | low | One entry per rejected tool in a session. Rejected |
| 16 | edge | Orphaned `.tmp` if rename throws | low | Same pattern as the session file. Rejected |
| 17 | edge | Stop hook breaks the `loadCommands` hot-path contract | false | `loadCommands` is unchanged; transcript and facts are read only on the blocking path |
| 18 | edge (claim) | A conductor that calls a tool after each block never reaches the cap | false | Intended: a tool call resets the count, exactly as Claude Code's cap does (proposal 4.6) |
| 19 | verification-gap | Counter-write failure path ("block holds") is untested | medium | Pre-verified gap → patch: add a hook test with `sessions/<s>.stop` as a directory |

Pass 2 (2026-10-25: edge-case-hunter on the patched tree; rows 1–3 fixed by the amended rule, 5, 8, 19 patched).

| # | Source | Finding | Verdict | Evidence / route |
|---|---|---|---|---|
| 20 | edge | Transcript/facts read throws → silent pass | low | carried: same as row 4. Rejected |
| 21 | edge | Whole transcript read per stop | low | carried: same as row 10. Rejected |
| 22 | edge | `stop_forced` appended, then counter write throws → counter stuck at 3 | low | Needs an fs failure right after a successful append; each later pass is still recorded. Fix adds guards → rejected |
| 23 | edge (+claim) | Unwritable stop file → cap never fires | low | Falls back to pre-6-1 behaviour (Claude Code's cap), error logged; covered by the new hook test. Rejected |
| 24 | edge | Corrupt stop file → duplicate `stop_yielded` | low | A repeated fact, never a lost one; needs a corrupt file. Rejected |
| 25 | edge | `locateTranscript` flipping between hits defers the cap | false | Needs two project dirs holding the same session id; AD-6 then finds none every time, not alternately |
| 26 | edge (+claim) | `isToolUse` ignores `sessionId` while the rejection match requires it | low | Direct correction, consistent scope → patched (`isToolUse(x, session)` + test) |
| 27 | edge | Several error tool_result blocks in one rejected entry | low | Observed transcripts write one tool_result per user entry. Rejected |
| 28 | edge | Orphaned `.tmp` on rename failure | low | carried: same as row 16. Rejected |
| 29 | edge (+claim) | /clear rebind leaves PAUSED | false | carried: same as row 14 (`session_bound` is a command) |
| 30 | edge | `human_prompt` fact doesn't clear PAUSED | low | carried: same as row 7. Rejected |

## Design Notes

Ids instead of timestamps for resets (newest tool fact id, last human entry `uuid`): no comparison between Claude Code's clock and the factory's. Tool facts come from async hooks; a lagging fact can only make the cap pass early, never block longer.

## Verification

**Commands:**
- `node --test test/*.test.ts` -- expected: all pass.
