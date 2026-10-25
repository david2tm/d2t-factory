---
title: 'Designer in parallel with spec'
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

**Problem:** SPEC_DESIGN issues only the spec-writer. No designer exists, so a UI task reaches gate 1 with no `design.md`. Reviewer-ui (3-3) would then have no reference, and the human never checks the look (CAP-6).

**Approach:**
- **Trigger.** On entering SPEC_DESIGN, the CLI issues `d2t-factory:designer` (sonnet) next to the spec-writer iff `recon.context.ui_surface` is true and `intake.ui_free` is not true (AD-27).
- **Mode.** `origin: brownfield` → inherit (extract from the repo, no question); otherwise → invent (UI-system defaults, everything else `[ASSUMPTION]`).
- **Output.** The designer writes one `design.md` (its step `out.md`): token front matter plus `## Components to use`, `## States` and `## Accessibility floor`.
- **Invent mode's one question.** It is a fenced `question` block, and the design is written for the default. A `design_choice` card asks it, and `/factory choose a|b` answers it.
- **Gate 1.** The card waits for a verified design with no unanswered question. It reads `Gate 1 — Spec + Design ready`, and `approve gate1` pins both files.

## Boundaries & Constraints

**Always:**
- `schedule`, `cards`, `artifacts`, `output` and `reducer` stay pure.
- Event changes are additive within `v:1`, and the fixture `*.state.json` shasums stay unchanged.
- Cards come only from `core/cards.ts`.
- A run with no designer behaves byte-for-byte as today, including the gate_1 card text.
- At most one question per run: once `design_choice_made` exists, a `question` block is a parse error. A question in inherit mode is always a parse error.

**Never:**
- FRAME, or the greenfield context: invent mode is reachable only from a context with `origin: greenfield` (5-2).
- Reviewer-ui, the roster, or slice tags re-triggering the designer (3-3).
- `rerun DESIGN` (it stays in `LATER`).
- New npm dependencies.
- Regenerating `test/fixtures`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Designer due | SPEC_DESIGN entered; `ui_surface: true`, `ui_free: false` | `next` issues spawn spec-writer (SPEC) and spawn designer (DESIGN) in one response | — |
| No designer | `ui_surface: false`, or `ui_free: true`, or no intake fields | Spec-writer only; gate 1 is as today | — |
| Design reported | Valid `design.md`, inherit, no question | `step_reported` then `step_verified`; gate_1 waits until both the spec lint and the design are done | Bad front matter, a missing section, or a question in inherit mode → `MISSING_EVIDENCE` and a reissue with the error in the brief |
| Question | Invent mode, one valid `question` block | After `step_verified`, `next` issues an ask_human `design_choice` card (stage DESIGN): `Design question — <question>`, with commands `/factory choose a` and `/factory choose b` | Two blocks, a malformed block, or `default` not `a`/`b` → `MISSING_EVIDENCE` |
| Choose default | `/factory choose <default>` | `design_choice_made{choice}`; the card is verified; the design stands; gate 1 can follow | No open design_choice card, or a phase other than SPEC_DESIGN → `ILLEGAL_TRANSITION` |
| Choose other | `/factory choose <non-default>` | `design_choice_made{choice, voids:[designer step, its step_verified]}`. A fresh designer (attempt+1) gets the chosen option, the previous design as input, and "ask no question" | — |
| Gate 1 | Spec lint passed, design verified, question answered | `Gate 1 — Spec + Design ready`. Reason: `<spec> · <design> (inherit) · N assumptions to check`, where N is the spec's plus the design's `assumptions[]`. `approve gate1` pins both with evidence `[lint, spec, design]` | Design missing or changed on disk → `MISSING_EVIDENCE` |
| Rework gate 1 | `/factory rework gate1 <note>` with a designer present | It voids the spec as today, plus the designer step and its `step_verified`. Both agents respawn with the note and their previous output as input | — |

</frozen-after-approval>

## Code Map

- `src/core/schedule.ts` `spec()` (:88), `due()` (:196): add `design(s)` under the SPEC_DESIGN case.
  - It follows `spec()`'s pattern: spawn; a voided verified step means a respawn at attempt+1.
  - Then the `design_choice` ask_human step, then `designerRequired(s)`.
  - `spec()` holds back the gate_1 card until the design is ready (verified, not voided, its question answered by a verified design_choice step issued after it).
- `src/core/artifacts.ts`:
  - Add `Design` and `validateDesign` to `SCHEMA.designer`:
    - `mode` must be `inherit` or `invent`;
    - `colors` is a non-empty JSON object of strings;
    - `typography`, `spacing` and `rounded` are optional objects;
    - `assumptions` is an optional string list;
    - the body must have the three `##` sections.
  - `checkOutput` takes `o.mode` and `o.no_question`, the way it takes `o.port`. Note that the front matter is the flat parser: nested maps go in as single-line JSON.
- `src/core/output.ts`: add `parseQuestion(body)` next to `parseFindings`. The fence is ```` ```question ````, with `question:`, `a:`, `b:` and `default: a|b` in that order. Add `question?` to `AgentOutput`, and store it in the output projection (`src/cli/steps.ts` `projection()`, :37).
- `src/core/cards.ts`: add `designChoiceCard(q)`. `gate1Card` takes an optional `design: {path, mode, assumptions}`; when it is absent, today's text stays.
- `src/core/verify.ts`:
  - `gateEvidence('gate1')` (:114): when the designer is required, also needs the ready design step, and returns it.
  - `reworkVoids('gate1')` (:127): also voids the designer step and its `step_verified`.
  - Add `latestDesign(s)` next to `latestSpec`.
- `src/core/reducer.ts:328`: `design_choice_made` pushes `data.voids` when present. `src/core/events.ts:98/161`: optional `voids`.
- `src/cli/decide.ts`:
  - Drop `design_choice_made` from `LATER` (:29), and add its case: SPEC_DESIGN, an open design_choice card, voids when the choice is not the default.
  - Gate 1 (:104) pins the design too, inline like the spec.
- `src/cli/done.ts`: the designer's `checkOutput` call passes `mode` (from `state.recon.context.origin`) and `no_question`.
- `src/cli/brief.ts`:
  - Add `FORMAT.designer`. The `inputs()` designer gets the context, the worktree and the previous voided design.
  - The facts gain `designer mode: inherit|invent` and `ui_reference`.
  - The notes gain gate-1 rework notes, plus the chosen option on a respawn.
- `agents/designer.md`: new. Model to `sonnet`; tools Read, Grep, Glob, Write. Mirror `spec-writer.md`.
- `src/core/projection.ts:222`: skip `design_choice` in the open-steps loop only if it would duplicate. The board already has the DESIGN card, Sela Venn and the `design_choice` label, so check that the card lands in Needs You with stage DESIGN.
- Tests:
  - `test/harness.ts` `reconOut` has `ui_surface: true`. Existing SPEC/gate-1 tests in `pipeline.test.ts`, `schedule.test.ts` and `verify.test.ts` get `ui_free: true` (via `recordIntake`) so their expectations hold.
  - Add `designOut()`.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/{output,artifacts,cards,verify,schedule,events,reducer}.ts` -- schema, question parser, cards, gate-1 evidence and voids, due logic per the Code Map.
- [x] `src/cli/{done,decide,brief,steps}.ts` -- mode-aware parsing, `choose` decision, gate-1 pin of the design, designer brief.
- [x] `agents/designer.md` -- the role: inherit vs invent, at most one question (two options + default, design written for the default), `[ASSUMPTION]` marks listed in `assumptions[]`, write one file, never run `factory`; ESCALATE `Spec ambiguity`.
- [x] `test/{output,artifacts,cards,schedule,verify,reducer,projection,pipeline}.test.ts` + `test/harness.ts` -- unit-test every matrix row; migrate existing gate-1 tests with `ui_free: true`.

**Acceptance Criteria:**
- Given a brownfield run through `bin/factory` with `ui_surface: true`, when SCAFFOLD is verified, then one `next` issues both spawns, gate 1 appears only after both report, and `approve gate1` records `pins` for spec and design and every command passes `validateEvent`.
- Given an invent-mode context, when the designer asks and the human runs `/factory choose b` (default `a`), then a second designer is issued whose brief names option b, and a question in its output is rejected.
- Given the repo, when Verification runs, then all tests pass, tsc reports 0 errors, and the fixture shasums are unchanged.

## Implementation Notes

- `designerRequired`, `designMode`, `latestDesign`, `readyDesign`, `designChoiceFor`, `designQuestionAnswered` and `designVoids` live in `core/verify.ts` (schedule, decide, brief and steps share them; `gateEvidence` needs `designerRequired`, so it cannot sit in schedule without an import cycle).
- The designer's `mode`/`no_question` are passed by `cli/steps.ts` `outputOpts()` inside `readOutput`, which `done` uses; the orphan path in `next` gets the same checks.
- "Question answered" = a verified `design_choice` ask_human step (only `decide` verifies it), so no new reducer state field; fixture snapshots are unchanged.
- Pipeline tests: `started()` now defaults the intake to `ui_free: true`; the 3-2 tests pass `ui_free: false`. Invent mode is reached from a RECON context with `origin: greenfield`.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-24): blind-hunter (B), edge-case-hunter (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| B1 | After gate 1, no step is given the approved design; the builder never reads it | medium | `inputs()` adds a design only for `designer`; the builder gets the pinned spec only | patch: the builder's inputs list the current design |
| B4/E6 | The body's `[ASSUMPTION]` marks are not tied to `assumptions[]`, so gate 1 can show `0 assumptions to check` | medium | `validateDesign` checks only that `assumptions` is a string list; the gate count reads `assumptions.length` | patch: the mark count must equal `assumptions.length` |
| E1/E2 | A designer brief puts the `choose` note after a newer gate-1 rework note under "newest last", so the old option overrides the rework | medium | `briefText` concatenates `reworkNotes(gate1)`, then `designChoiceNotes` | patch: interleave both in event order |
| V1 | The designer brief's `ui_reference` fact is untested | medium (pre-verified) | no test has a context with `ui_reference`; deleting the push keeps the suite green | patch: test |
| B2 | `choose c` voids the design as a non-default choice | false | `decision.ts` accepts only `choose a` or `choose b`; anything else is task text | reject |
| B3 | A run at gate 1 from before this change, with intake fields and a UI surface, gets stuck | low | Not stuck: the designer is issued, and approve passes once the design is ready (only the card text is stale). Needs a run left at gate 1 between 3-1 and 3-2 | reject |
| B5 | `ui_reference` is not redacted in the brief | false | `briefText` redacts only human notes and errors by design; redact values come from SCAFFOLD, after RECON | reject |
| B6/E3/E5 | The question and heading scans don't respect fences or variants (` ```Question `, `~~~`) | low | The designer writes the documented format; a missed question falls back to the default design; the fix adds a fence-aware scanner | reject |
| B7/E4 | `validateDesign` accepts `null` token maps, unknown keys and empty color strings | low | No reader of the token maps exists yet (3-3); the fix adds guards | reject |
| B8 | The harness change weakens the `ui_free` default coverage; designer + BUILD are never run together | false | `ui_free` has no default (`validateIntake` requires it); the acceptance test reaches SLICE_PLAN with the designer | reject |
| B9/E7 | `design_choice_made.voids` isn't type-checked by `validateEvent` | low | Only the CLI writes it, from `designVoids`; the reducer guards `Array.isArray` | reject |
| B10 | The designer's ESCALATE and the "no longer current" branch are untested | low | `rule E<n> retry` reissues the subject step generically (`decide.ts:171`); a stale open choice card is unreachable while `rerun` stays in `LATER` | reject |
| B11 | Invent mode never names its UI system | low | Invent mode is reachable only from greenfield (5-2); FRAME's `ui_reference` already reaches the brief as a fact | reject |
| B12 | The designer agent isn't registered; there are no docs for `choose` | false | Agents are flat files under `agents/`, so `plugin.json` lists none; SKILL.md prints any card-only `ask_human` | reject |
| E8 | No intake record means no designer even with a UI surface | false | The frozen matrix row "No designer" lists "no intake fields" | reject |

## Design Notes

- **Why the default is written first.** The design is usable even before the human answers, and on the default answer no second ~10 min sonnet run is needed. A non-default answer reuses the gate-1 void and respawn path, so the reducer gains no transition.
- **Why the card is schedule-driven, not `ask_raised`.** Like gate cards, the design question is a planned ask with no `E<n>` number. `raise()` would number it as an escalation.
- **design.md example:**

```
STATUS: DONE
---
mode: inherit
colors: {"primary": "#1f6feb", "surface": "#ffffff", "text": "#1f2328"}
typography: {"body": "14px/1.5 system-ui"}
assumptions: []
---
## Components to use
## States
## Accessibility floor
```

## Verification

**Commands:**
- `node --test test/` -- expected: all pass (port-binding tests need to run outside the sandbox).
- `npm i --prefix "$TMPDIR/tsc" --cache "$TMPDIR/npm-cache" typescript@7.0.2 @types/node@22 && "$TMPDIR/tsc/node_modules/.bin/tsc" -p tsconfig.json --typeRoots "$TMPDIR/tsc/node_modules/@types"` -- expected: exit 0.
- `shasum test/fixtures/*.state.json` before and after -- expected: identical.
