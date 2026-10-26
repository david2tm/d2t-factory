---
title: 'Claim waiting states and pinned-artifact view'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_commit: '5711cd1f39b4118ecd982fa2880fb81a104d3f8d'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In dry run 1, the intake claim and the scaffolder claim turned red UNVERIFIED while they were really waiting on Master d2t or on the CLI's checks (finding 5). The human also couldn't read the artifacts a gate asked them to approve (finding 8; CAP-15).

**Approach:** `claimOverlay` (AD-7) works out what a reported claim is waiting on. The CLI's wait deadline and the board both read that single result, and only a claim waiting on nothing but hook facts can go overdue. At `step_verified` of an intake, spec-writer, designer or slicer step, the CLI embeds the redacted body, sha256 and path in the event data (AD-23, AD-14). The board shows these in a new read-only Artifact drawer with Copy path. It never reads `artifacts/`.

## Boundaries & Constraints

**Always:**
- **What the claim waits on.** `claimOverlay` adds `waiting_on: 'human' | 'checks' | null` and `waiting_for: string | null`.
  - **`human`.** The step is an `ask_human` step, or an open ask has it as its subject (`askOpenFor`). `waiting_for` is that ask's card title, or else the step's own card title.
  - **`checks`.** The step is a scaffolder that reported `DONE` with no failure, no open ask, and is not yet verified. This mirrors the `schedule.ts` SCAFFOLD condition, so the gaps before each check is issued count too. `waiting_for` names the contract checks not yet verified (`install, health, test`).
  - **Overdue.** `overdue_at` is null whenever `waiting_on` is not null.
- **One overdue rule.** `next.ts` `view()` takes its overdue deadlines only from `claimOverlay` (claimed, not waiting). Spawn and resume steps get the same deadlines as before.
- **Board wording** (EXPERIENCE/DESIGN): chip `CLAIMED · awaiting Master d2t` / `CLAIMED · checks running`, with the gloss in holo-text-2. Drawer proof row `waiting on Master d2t — <title>` / `waiting on <checks>`. The truth legend and the top-bar counts stay as they are.
- **Embed.** `data.artifact = {path, sha256, body, truncated}`.
  - **Body.** The redacted body: `redact` with the run's values, then cut on a UTF-8 boundary to `ARTIFACT_EMBED_MAX` bytes. `truncated` is true when the body was cut.
  - **sha256.** It must equal the step's reported `output.sha256`, which is what the gates pin. If the file now hashes differently, there is no embed.
  - **When.** Every `step_verified` path for these four steps embeds: `reportEvents`, the async-facts path in `next.ts`, and the `intake_confirmed` path in `decide.ts`.
- **Projection.** `Lane.artifacts?` is omitted when it would be empty.
  - Each entry: `{id, step_id, stage, name, path, sha256, body, truncated, superseded, pinned_by}`.
  - `id` is the `step_verified` event id.
  - `name` is `intake.md`, `spec.md`, `design.md` or `plan.md`.
  - `superseded` is true when the step or its verified event is voided (AD-33).
  - `pinned_by` is the id of the decision whose `pins` hold this path and sha256, or null.
  - Gate 1 and Gate 2 `needs_you` entries gain `files?` (artifact ids): the current artifacts that the gate's evidence names.
- **Timeline.** Timeline frames carry artifacts without `body`. The bodies sit once each in `Timeline.artifact_bodies?` (keyed by artifact id), and the browser joins them back.
- **Artifact drawer** (DESIGN Panels):
  - It opens from a Gate card file row (a button with the name), the intake seal, or a Decision drawer evidence row whose id has an artifact.
  - Title `Artifact · <name> · <run-id>`.
  - Meta table:
    - the path with a 30×30 `Copy path` button, giving `Copied` or `Copy failed — path selected`;
    - the sha256, first 12 characters shown, full value in the accessible name;
    - `pinned by <seal line>` in gold, or `not yet approved` in text-3, plus `superseded` when superseded.
  - The body in mono, read-only and scrolling, with no Markdown rendering. A `truncated at 64 KB` note appears when the body was cut.
  - Gold-rule note: **Master d2t approves these bytes.**
- **Line cap (decided by d2t, 2026-10-26).** `MAX_LINE_BYTES` goes from 32 KiB to 96 KiB, so the event that carries a 64 KiB body fits on one line. `ARTIFACT_EMBED_MAX` stays at 64 KiB, and the drawer note reads `truncated at 64 KB`. Update AD-28 in `ARCHITECTURE-SPINE.md:481` to say 96 KiB. `serialize`'s halving stays as the last-resort guard against JSON escaping.
- Changes stay additive within `v:1`. Old events without `artifact` project as before.

**Never:**
- No new route, process, dependency or event kind.
- The dashboard never reads `artifacts/`, and its GET-only server stays unchanged.
- Don't change `CLAIM_OVERDUE_MS`, the stored events of recordings, or what any command does.
- Don't touch 6-4 (SCAFFOLD repair).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Intake waits | intake chat reported, no approval for 60 s | CLAIMED, `waiting_on: human`, `overdue_at: null`; no `next` deadline from it |
| Checks running | scaffolder DONE, install verified, health/test pending, 60 s | CLAIMED, `waiting_on: checks`, `waiting_for: health, test` |
| Escalation | builder ESCALATE, escalation ask open | `waiting_on: human`, `waiting_for` = card title |
| Hook facts only | spawn reported, no `subagent_stopped` | UNVERIFIED at report + 30 s (unchanged) |
| Secret in spec | spec body holds a redact value | embedded body has `[REDACTED]`; sha256 = reported sha |
| Over cap | body > `ARTIFACT_EMBED_MAX` | body cut, `truncated: true`, event line ≤ `MAX_LINE_BYTES` |
| Rework | Gate 1 rework, new spec verified | old artifact `superseded: true`, new one `pinned_by: null` until passed |

</frozen-after-approval>

## Code Map

- `src/core/config.ts` -- add `ARTIFACT_EMBED_MAX = 64 * 1024` (AD-21 style comment); `MAX_LINE_BYTES` (:25) to `96 * 1024`. Its only user is `serialize` (`src/store/jsonl.ts:22-36`); `test/store.test.ts:46` scales with it.
- `_bmad-output/planning-artifacts/architecture/architecture-d2t-factory-2026-10-23/ARCHITECTURE-SPINE.md:481` -- AD-28 line cap 32 KiB → 96 KiB.
- `src/core/verify.ts:117-128` -- `ClaimOverlay` + `claimOverlay`: add `waiting_on`/`waiting_for`, null `overdue_at` when waiting. Reuse `askOpenFor` (:108), `latestCheckStep` (:28), `isVerified`; mirror `schedule.ts:89-94` for checks. Callers: `projection.ts:244`, `next.ts:471` only.
- `src/cli/next.ts:466-478` `view()` -- replace the spawn/resume/`askOpenFor` filter with overlay `claimed && waiting_on === null`; it only feeds `deadlinesAhead`/`nextDeadlineMs` (no time-based reissue exists).
- `src/cli/next.ts:394-397` -- async-facts verify: pass the `readOutput` result to `verifiedEvent`.
- `src/cli/steps.ts:22-60,133-143` -- `ReadOutput` has `text`/`sha256`; add `artifactData(c, path, text, reportedSha)` (redact via `readRedactValues`, byte cap) and an optional `out` param on `verifiedEvent`, embedding only for roles `spec-writer|designer|slicer`. `reportEvents` (:133) already holds `out`.
- `src/cli/decide.ts:76-94` -- `intake_confirmed`: add `artifact` to the `step_verified` data from the text read at :87 and `pin.sha256`.
- `src/core/events.ts:104` -- `step_verified` data gains optional `artifact` (validation at :179 unchanged).
- `src/core/redact.ts` -- reuse `redact`/`redactString`; no change.
- `src/core/projection.ts` -- `Claim` (:17) gains `waiting_on`, `waiting_for`, `overdue_at: string|null` (:249 drops `!`); `openClaims` (:306) skips null `overdue_at`; `trace()` (:126-143) captures `data.artifact` + event id; `ArtifactView`, `Lane.artifacts?`, `NeedsYou.files?` (gate asks, from `gateEvidence`-style ids: spec/design for gate 1, spec/plan step for gate 2 -- the slicer step); `pinned_by` from decisions' `pins`; `superseded` via `isVoided`.
- `src/core/timeline.ts:73-85` `buildTimeline` -- strip `body` from frame lanes into `artifact_bodies` (absent when empty).
- `src/dashboard/web/src/lib/types.ts` -- mirror `Claim`, `ArtifactView`, `Lane`, `NeedsYou`, `Timeline` (`test/web-model.test.ts:21` `asWeb` enforces parity).
- `src/dashboard/web/src/lib/model.ts:45-65` -- `chipState` (null `overdue_at` already stays claimed); add a gloss helper and an artifact lookup (`artifactFor(lane, id)`, body join for replay); `sealLine` (:242) for `pinned by`.
- `src/dashboard/web/src/lib/drawer.ts:6-25`, `lib/replay.ts:120` -- `kind: 'artifact'`, `selectionPresent` case.
- `components/ClaimChip.svelte:15`, `Drawer.svelte` (:72 hero, :91 proof row, :127-138 evidence rows, new Artifact branch), `NeedsCard.svelte` (file-row buttons), `Seal.svelte`/`StageCard.svelte:27` (intake seal → artifact), copy logic pulled from `ActionSlot.svelte:19-39` into a shared helper.
- `dashboard/dist` -- rebuild (`npm run build` in `src/dashboard/web`) as `test/web-build.test.ts` expects.
- Tests: `test/verify.test.ts` (state builders :51-62, `isParked` :456), `test/projection.test.ts:59,99`, `test/web-model.test.ts:34,221,231`, `test/driver.test.ts:294`, `test/pipeline.test.ts` (`toScaffold` :103, `toChecks` :467, secret sweep :1067), `test/dashboard.test.ts:173` (never reads artifacts/, keep), `test/timeline.test.ts` (`UPDATE_SNAPSHOTS=1`).

## Tasks & Acceptance

**Execution:**
- [x] `src/core/config.ts`, `ARCHITECTURE-SPINE.md`, `src/core/verify.ts`, `src/cli/next.ts` -- constants and the AD-28 line cap; overlay waiting; one overdue rule.
- [x] `src/cli/steps.ts`, `src/cli/next.ts`, `src/cli/decide.ts`, `src/core/events.ts` -- embed at the three `step_verified` paths.
- [x] `src/core/projection.ts`, `src/core/timeline.ts` -- claim fields, artifacts, gate `files`, body hoisting.
- [x] web `types.ts`, `model.ts`, `drawer.ts`, `replay.ts`, `ClaimChip`, `Drawer`, `NeedsCard`, `Seal`/`StageCard`, copy helper; rebuild `dashboard/dist`.
- [x] Tests -- every matrix row; `next` wait deadline ignores waiting claims; projection never reads `artifacts/` (kept); timeline joins bodies; web gloss/proof-row helpers; regenerate `*.timeline.json` snapshots.

**Acceptance Criteria:**
- Given the full suite, when run, then it passes; `*.timeline.json` changes only by the new claim keys (noted), stored events unchanged.
- Given the pipeline harness through Gate 2, when the lane is projected, then intake, spec, design and plan artifacts exist, each `pinned_by` its gate decision, and no recorded file contains `SECRET`.

## Implementation Notes

- **Timeline snapshots.** Every `*.timeline.json` changed in each claim: two new keys, `waiting_on` and `waiting_for`. In `pipeline-acceptance` only, the intake and scaffolder claims that now wait also show `overdue_at: null`, in the claim and in the lane's `deadlines.overdue_at`. That is 7 of 58 frames, and the change is deliberate. No stored `*.jsonl` event changed.
- **Intake seal.** It opens the Artifact drawer when the run embedded the intake. The drawer's gold `pinned by …` line is a button back to the intake Decision drawer. Runs recorded before 6-3 have no artifacts, so their seal still opens the Decision drawer.
- **`pinned_by`.** It is the first decision whose pins match. For the spec that is Gate 1, even though Gate 2 and the merge pin it again.
- **Body element.** The body is a read-only `<textarea>`, which scrolls and can be focused without a Svelte a11y warning.
- **Line cap.** If JSON escaping ever pushes a 64 KiB body past 96 KiB, `serialize` halves it and adds `…[truncated]`. The `truncated` flag stays false in that case. A body of quotes, multi-byte text and newlines at the cap still fits on one line (`test/cli.test.ts`).
- **Old recording.** `pipeline-acceptance` was captured before the contract checks existed, so its scaffolder claim reads `waiting on install` until it is verified.
- **New files.** `lib/copy.ts` is the shared copy helper. `ArtifactButton.svelte` is the file row used on Gate cards and in Decision drawer evidence rows.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-26: blind-hunter, edge-case-hunter, verification-gap).

| # | Source | Finding | Verdict | Evidence / route |
|---|---|---|---|---|
| 1 | verification-gap, blind | `verifiedEvent` falls back to the re-read sha256 when the report has none, and no test separates the reported sha from the re-read one | medium | A pre-verified gap, and the fallback weakens the frozen sha rule. Patch: drop the fallback, add a test |
| 2 | blind | AD-7 in ARCHITECTURE-SPINE still defines `checks` as "run_check steps issued and not verified" | low | The code follows the SCAFFOLD schedule on purpose (Design Notes). Patch: one-clause doc fix |
| 3 | blind, edge | JSON escaping can push a 64 KiB body past 96 KiB; `serialize` then halves it and `truncated` stays false | low | Needs a body more than half quotes, backslashes or control characters. The fix adds escaped-length logic. Already noted in Implementation Notes. Rejected |
| 4 | blind | "Master d2t approves these bytes" sits over a redacted, possibly cut body | low | That wording is the frozen DESIGN text, so the fix would edit the spec. Rejected |
| 5 | blind | A failed embed (file changed or missing) is silent | low | The gate itself refuses a changed file (`decide.ts` `pinOf`). Adding a marker adds surface. Rejected |
| 6 | blind | Artifact bodies now go into `commands.jsonl` and recordings | false | This is the frozen intent (AD-23: embed in event data, redacted through AD-14) and is test-covered. Rejected |
| 7 | blind | A raw-file sha256 beside a redacted body lets someone brute-force a short secret | low | Redact values are env and secret tokens (high entropy). The sha256 sits beside the body by intent, and the pins already carried it. Rejected |
| 8 | blind, edge | `pinned_by` can name a voided decision | low | Needs a voided gate whose artifact isn't superseded and is re-pinned with the same bytes. A rerun voids the stage's step too, so the artifact is superseded. Rejected |
| 9 | blind | `ArtifactView.superseded` ignores reissued and cancelled | false | Artifacts exist only for verified steps, and only open steps are reissued or cancelled. Rejected |
| 10 | blind, edge | A `checks` label is stale when all checks are verified, or when install fails, before the next `next` | low | Lasts only until the conductor's next `next`, which verifies or raises the card. The fix adds branches. Rejected |
| 11 | blind | `waitingOf` rewrites `askOpenFor` inline | false | It needs the ask's card title, which `askOpenFor` (a boolean) can't give. Rejected |
| 12 | blind | `next --wait` deadlines now come from every step kind | false | Deliberate under the frozen "one overdue rule". `run_check` is reported and verified in one append (`check.ts:209-211`). Rejected |
| 13 | blind | `truncated at 64 KB` is a hard-coded literal | low | It is the frozen wording. Rejected |
| 14 | blind, edge | `withBodies` turns a missing body into an empty one | false | `buildTimeline` writes every framed artifact's body into `artifact_bodies`. Unreachable. Rejected |
| 15 | blind, edge | The intake Decision drawer is unreachable, or `openPin` does nothing | false | The intake artifact's pin is the decision's own pin, so `pinned_by` links back. Every pinning decision seals a card (`sealTargets`). Rejected |
| 16 | blind | Superseded bodies stay in the live lane with no size limit | low | Bounded by rework rounds, a few at most. Rejected |
| 17 | blind, edge | No Svelte tests; the `copied` glyph persists for 1.5 s across a drawer swap | low | The repo has no component tests (convention). The glyph is cosmetic. Rejected |
| 18 | edge | An Artifact or claim opened from inside the Decision drawer loses focus return on close | low | Real: the in-drawer opener's `data-src` is gone after the swap. The in-drawer ClaimChip already behaved this way. Deferred as a pre-existing pattern |
| 19 | edge | A stalled `run_check` never makes the scaffolder claim overdue | low | The frozen intent: a claim waiting on checks never goes overdue, and `factory check` has its own CHECK_TIMEOUT_MS. Rejected |
| 20 | edge (claim) | The AC says the timeline changes only by claim keys, but `overdue_at` values changed too | low | Noted in Implementation Notes. Fixing it would edit the spec. Rejected |

## Design Notes

Bodies sit outside the frames because a timeline stores one full lane for every distinct frame. Inline bodies would repeat up to ~100 KB in each of a few hundred frames. The live board serves lanes with bodies inline, through the existing GET only.

The `checks` wait follows the SCAFFOLD schedule rather than the check steps alone. `contract.install` is issued only on the `next` after the report, and health and test only after install passes. A literal "issued and not verified" test would read null in those gaps, and the claim would turn red.

## Verification

**Commands:**
- `node --test test/*.test.ts` -- expected: all pass.
- `rg -n "artifacts/" src/dashboard src/core/projection.ts src/core/timeline.ts` -- expected: no file reads (comments only).
