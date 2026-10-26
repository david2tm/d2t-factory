---
title: 'Every agent role has a character; the CLI''s checks are droids'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_commit: '06bb37940b673b467e8b9f467259f0460a2f1ba3'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On the board, recon, framer, scaffolder, spec-writer and slicer are drawn as the conductor and labelled with raw role ids. CLI checks show by internal id (`contract.health`) (dry run 2 findings 1, 2; CAP-15).

**Approach:** Apply `sprint-change-proposal-2026-10-26.md` sections 4.2 and 4.3 as approved. Five new characters, each standing at its stage card while In Progress. One shared check-droid chassis, named per `run_check` id, stands beside a card while that check runs, and its name shows in claim, verdict and drawer rows. One additive projection field (AD-23), no event change (AD-32). The 4.2/4.3 contract edits go into DESIGN, EXPERIENCE and the spine.

## Boundaries & Constraints

**Always:**
- Names, looks, colors and droid ids exactly as in the proposal tables (short name everywhere, full name only in the DESIGN roster table), with two renames for the DESIGN hard rule:
  - The scaffolder is Dockmaster Tamsin Brann (`Tamsin`), not Orla, because Orla Jareni is a Star Wars character.
  - The recon character is Surveyor Nyra Kest, not Pathfinder.
  Everything else about both characters is unchanged.
- Sprites: 16×16, shared 20-color `sprite-*` palette only, two effect frames, `aria-hidden`. Effects stop under reduced motion (frame 1 shows).
- Droids have no role color. Their dot is a 6 px outlined square (1 px `text-2`), and it never means state. The status light is decoration only.
- `checks_running` is display-only, derived in `projection.ts` from `RunState`. It lists the card's `run_check` steps that are open (issued, claimed or reported), not voided, not reissued and not cancelled, in issue order.
- The 6-3 `waiting on health, test` gloss keeps check role labels. `git.*` and `devserver` keep their check names (evidence rows only), and the drawer's `check` evidence row keeps the raw id.

**Never:** no event, reducer, CLI or route change. Don't put the conductor sprite on any card (INTAKE and WRAP show none). Don't give a droid a role color. Don't add pass/fail state to sprites.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Stage agent | RECON/FRAME/SCAFFOLD/SPEC/SLICE PLAN card in `in_progress` | Nyra/Halden/Tamsin/Ione/Sorel stands at it. DESIGN shows Sela Venn. INTAKE and WRAP show no agent. |
| Scaffold checks | SCAFFOLD with install verified and health issued | `checks_running: ['contract.health']`; the crew is Tamsin + Pulse |
| Droid alone | WRAP in progress with `contract.health` running | crew is Pulse only |
| Slice checks | slice in `in_progress` / `in_review` with a BUILD check open | builder or reviewers, then the droid |
| No checks | no open `run_check` on the card | field absent; crew as before |
| Check claim | verified `contract.test` claim row | outlined dot · `Gauge` · chip; drawer reads `Evidence · S1 Gauge · VERIFIED` |
| Unknown role | role not in the roster | the raw role as the name, `vess` sprite fallback (unchanged) |

</frozen-after-approval>

## Code Map

- `src/core/projection.ts` -- `BoardCard` gains `checks_running?: Check[]`, set only when non-empty (like `at_risk`/`tags`), so old frames keep their shape. Fill it in the stage and slice card loops from `s.step_order` (step `kind === 'run_check'`; card = `slice:<id>`, else `stage:<stage>`; BUILD without a slice → none). Reuse `isVoided` and the `OPEN_STEP` states (`issued|claimed|reported`).
- `src/dashboard/web/src/lib/types.ts` -- mirror `checks_running?: string[]` on the browser `BoardCard`.
- `src/dashboard/web/src/lib/sprites.ts` -- `SpriteName` gains `nyra|halden|tamsin|ione|sorel|droid`. `SPRITES` gets six 16×16 maps in the existing style (see `brix`, `pell`). `BY_ROLE` gets the five roles and the five check ids → `droid`. Update the header comments.
- `src/dashboard/web/src/components/Sprite.svelte` -- effect timings: halden 1.4 s, ione 1.2 s, sorel and tamsin blinks. Nyra's 3-frame cone: a/b/neither keyframes on `.spr-nyra` (frame 1 under reduce, because `[data-motion=reduce]` sets `animation:none`). Droid light: `a` = slate (idle), `b` = holo (blink).
- `src/dashboard/web/src/lib/model.ts` -- `ROSTER` gains five characters (`var(--role-*)`) and five checks `{ name, label, outline: true }`. Add `roleLabel(role)` (label ?? role) and `isDroid(role)`. Fix the roster comment.
- `src/dashboard/web/src/lib/tokens.css` -- `--role-recon`, `--role-framer`, `--role-scaffolder`, `--role-spec-writer`, `--role-slicer` beside the existing `--role-*`.
- `src/dashboard/web/src/components/Lane.svelte` -- `agentsAt`: stage→role map (`STAGE_AGENT`), then append `card.checks_running`, deduped. Update its comment.
- `src/dashboard/web/src/components/Agent.svelte`, `ClaimList.svelte` -- the role label via `roleLabel`, and the outlined dot for droids (`class:droid`: transparent fill, 1 px `--text-2` border; global `box-sizing: border-box`).
- `src/dashboard/web/src/components/Drawer.svelte` -- already uses `displayName`; no change expected, verify only.
- `dashboard/dist/` -- rebuild with `npm run build` in `src/dashboard/web` (`test/web-build.test.ts` compares bytes).
- `test/fixtures/recordings/pipeline-acceptance.timeline.json` -- will change (it has 8 `run_check` steps). Regenerate with `UPDATE_SNAPSHOTS=1 node --test test/timeline.test.ts`. The diff must be `checks_running` additions only.
- Docs: `planning-artifacts/ux-designs/ux-d2t-factory-2026-10-23/DESIGN.md` (front-matter role tokens, Role colors paragraph, Character roster rows, new `### Check droids`, Agent sprite appends). `EXPERIENCE.md` (stage table "Path on board" lines 83–86, Voice and Tone line 170, Agent sprite row 198). `architecture/.../ARCHITECTURE-SPINE.md` (AD-23 rule bullet; remove deviation row 753). Edit texts are in the proposal, verbatim, except: use Tamsin for Orla (in the EXPERIENCE SCAFFOLD line too) and Surveyor for Pathfinder.
- Don't touch: `core/verify.ts` (`waitingOf` gloss), `core/events.ts`, the reducer, the CLI.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/projection.ts`, `src/dashboard/web/src/lib/types.ts` -- add `checks_running`.
- [x] `lib/tokens.css`, `lib/sprites.ts`, `components/Sprite.svelte` -- tokens, six placeholder sprites, `BY_ROLE`, effect CSS.
- [x] `lib/model.ts`, `components/Agent.svelte`, `components/ClaimList.svelte`, `components/Lane.svelte` -- roster, labels, outlined dot, `agentsAt`. Move `agentsAt` into `model.ts` (pure, exported) so it can be tested.
- [x] `test/projection.test.ts` -- `checks_running` on SCAFFOLD (install verified, health issued → `['contract.health']`), absent once verified, voided/reissued steps excluded, slice and WRAP placement.
- [x] `test/web-model.test.ts` -- every role in `REVIEWERS` + builder, designer, recon, framer, scaffolder, spec-writer and slicer maps to a non-`vess` sprite and a roster name ≠ the role. Each of the five `run_check` ids → `droid`, its name and label, `isDroid`. `agentsAt` per stage card and with droids.
- [x] `test/web-replay.test.ts` -- over pipeline-acceptance frames: no check claim's `displayName` is a raw check id, and the existing equivalence test still passes.
- [x] Docs above, then rebuild `dashboard/dist` and regenerate the snapshot.

**Acceptance Criteria:**
- Given any board frame, when a card shows a name for a role or `run_check` id, then it is the roster short name, never the raw id.
- Given an epic-6 recording (pipeline-acceptance; by hand, the dry-run-2 archive), when replayed, then the board shows the new names and sprites with no projection error, and the snapshot diff is `checks_running` only.
- Given reduced motion, when droids or new characters are shown, then they hold frame 1.

## Implementation Notes

- Snapshot: every event's frame in `pipeline-acceptance.timeline.json` equals its old frame with `checks_running` removed, and the events and metadata are otherwise unchanged. Frames that used to be identical now differ by `checks_running`, so the timeline goes from 58 to 66 deduplicated frames. As a result, the events' `frame` indices shift in the diff.
- Claims for steps the conductor runs itself (`ask_human`, `enter_worktree`, `exit_worktree`) carry their step kind as `role` and still show it as the name. These are not agent roles or `run_check` ids, so they are outside this story. The replay test checks only `spawn`, `resume` and `run_check` claims.

## Spec Change Log

## Review Triage Log

Pass 1. Blind Hunter, Edge Case Hunter and Verification Gap reviewed the source diff. The generated `dashboard/dist` bundle and the timeline snapshot were left out of the review diff; tests check both.

- medium · patch (verification gap, pre-verified; the Blind Hunter flagged the same duplication): the droid dot and label choice is inline in `Agent.svelte` and twice in `ClaimList.svelte`, and no test covers it. It becomes one `model.ts` helper with a test.
- low · patch (Edge Case Hunter, Blind Hunter): the `.crew` row doesn't wrap, so five reviewers plus a check droid overflow the In Review cell. Fixed with `flex-wrap`.
- false (both hunters): "a `git.*`/`devserver` run_check shows a raw id with the conductor sprite". `schedule.ts` only ever issues run_check steps for the five droid checks.
- false (Edge Case Hunter): "a pending stage card with open checks is skipped". Checks are issued at the current stage, so a stage with open checks is never pending.
- low · rejected (Edge Case Hunter, twice): "a droid is hidden on a needs_you or done card". The board drew no crew in those columns before this change either. Checks are verified (pass or fail) before a card escalates or waits at a gate. Fixing it would mean new layout branches.
- false (Blind Hunter): "droid rows lose the check name". The intent puts droid names in claim, verdict and drawer rows the way it puts character names there. The role label shows under the sprite.
- low · rejected (Blind Hunter): "the new role colors are not in the sprite palette, so they can't be sprite accents". The colors are the approved ones. Viewers wouldn't notice, and fixing it needs a UX palette decision.
- false (Blind Hunter): "`role-slicer` equals `sprite-skin-light`". The proposal states this on purpose.
- low · rejected (Blind Hunter): "no test for contrast or for DESIGN/tokens sync". All role tokens are copied by hand the same way, and the contrast values are in the Design Notes.
- false (Blind Hunter): "droids are not beside the card". The proposal says beside the card's agent (or alone), which is the crew row.
- false (Blind Hunter): "EXPERIENCE only names droids at SCAFFOLD", and "the spine wording differs from the code". Both texts are the approved edits verbatim, and the Agent sprite row states the general rule.
- low · rejected (Blind Hunter): "the replay droid assertion is circular". The projection unit test covers "gone once verified".
- false (Blind Hunter): "a reduced-motion droid looks idle". The intent says frame 1 under reduced motion, and the light never means state.
- false (Blind Hunter): "the story, dist and snapshot are missing from the diff". They were left out on purpose. `web-build` and `timeline` tests pass.
- low · rejected (Blind Hunter): the pointer comment left in `Lane.svelte`. It names where `agentsAt` lives now.

## Design Notes

`checks_running` is optional rather than always present, as the projection's other additive fields are (`at_risk`, `tags`, `paused`, `artifacts`). This keeps frames without running checks byte-identical. The five new role colors pass the 3:1 floor on `space-2` (recon/framer 9.4, scaffolder 7.4, spec-writer 7.5, slicer 11.5). Periwinkle `#8ea2ff` sits near designer violet `#a487ff`. The proposal accepted that, and it is noted for UX, not changed.

## Verification

**Commands:**
- `node --test test/*.test.ts` -- expected: all pass (web-build included, with `src/dashboard/web/node_modules` present).
- `git diff --stat test/fixtures/recordings` -- expected: only `pipeline-acceptance.timeline.json`, `checks_running` lines only.

**Manual checks:**
- Replay pipeline-acceptance in the dashboard: Tamsin and droids at SCAFFOLD, Ione at SPEC, Sorel at SLICE PLAN, droids at WRAP, and outlined dots on check rows.
