---
title: 'Plugin skeleton and functional core'
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The 1-1 skeleton already exists and its 30 `node:test` tests pass, but it never had a spec. Checking it against AD-1–5, 19, 28, 29 and 35 turned up these gaps: tsc can't type-check it, a malformed command line can crash the "total" fold, two state-machine rules and `actor` validation are missing, and nothing tests the AD-2 import direction.

**Approach:** Keep the existing code and close only those gaps, each with `node:test` coverage. Defer lock hardening (Design Notes).

## Boundaries & Constraints

**Always:** Node built-ins only (AD-19). `src/core` stays pure: no `node:` imports, no I/O. Relative `.ts` imports, `import type`, erasable syntax only. The JSON contract on stdout stays `{error:{code,message}}`. The existing fixture snapshots stay byte-identical. If a new rule rejects a fixture event, the scenario was wrong: fix `generate.ts`, regenerate, and say so in Implementation Notes.

**Never:** No `package.json` at the plugin root, and no dependencies outside `src/dashboard/web`. Out of scope: CLI verbs beyond `setup` (1-2), hooks (1-3), `skills/`/`agents/` (1-2/1-4), editing the spine.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Malformed command | `commands.jsonl` line that parses but lacks `data` or has an unknown kind | `loadRun` skips it and reports it in `skipped`; `fold` never throws | `fold` also catches, so a direct call records the event in `rejected` |
| Malformed fact | fact line that fails `validateEvent` | Dropped from `facts`, reported in `skipped` | — |
| Early WRAP | `stage_completed` in BUILD with a slice not CLOSED/CUT | Rejected: `slice S<n> is <state>` | `apply` returns `ok:false` |
| Second open step per role | `step_issued` role R while an R step is issued/claimed/reported | Rejected (AD-24 limit) | Steps with no role are exempt; `step_reissued` is unaffected |
| Bad actor | a command whose actor isn't `cli`, `conductor`, `human` or `d2t-factory:<role>` | `validateEvent` fails | Facts' actor stays unconstrained until 1-3 defines the hook writer |
| Settings not writable | `~/.claude/settings.json` write fails (EPERM in the sandbox) | `SETUP_FAILED` with "run factory setup in your own terminal" | Tmp file removed; the original is untouched |

</frozen-after-approval>

## Code Map

- `src/core/events.ts:173-204` -- `validateEvent`.
- `src/core/reducer.ts` -- `step()`: `stage_completed` (l.140), `step_issued` (l.148); `fold` (l.343). `apply` is the CLI's pre-append gate; keep its contract.
- `src/store/load-run.ts:16-35` -- `loadRun`; report each failure in `skipped` with `error` set to the joined validation errors.
- `src/store/jsonl.ts:22,40` -- the `{ data?: unknown }` param type is too narrow: `test/store.test.ts:26-31` fails tsc.
- `src/cli/setup.ts:76-82` -- the settings write.
- `tsconfig.json` -- correct; tsc fails only because no `"type":"module"` sits above the files (TS1295/TS1287).
- `test/fixtures/generate.ts` + `*.jsonl`/`*.state.json` -- deterministic fixtures. Regenerate only if a new rule rejects a scenario event.
- Reuse: `isFactKind`, `openSteps`, `FactoryError`, and the temp-dir `FACTORY_HOME`/`FACTORY_CLAUDE_SETTINGS` setup in `test/cli.test.ts`.
- Leave as is: `bin/factory`, `bootstrap.mjs`, `paths.ts`, `ids.ts`, `locks.ts`, `plugin.json`, `hooks/hooks.json` (empty until 1-3).

## Tasks & Acceptance

**Execution:**
- [x] `src/package.json`, `test/package.json` -- add `{"type":"module"}` only. That lets tsc see ESM without putting a package.json at the plugin root (AD-19).
- [x] `src/store/jsonl.ts` -- widen the `appendLine`/`serialize` parameter type.
- [x] `src/core/events.ts` -- non-fact kinds require `actor` ∈ {`cli`,`conductor`,`human`} or `/^d2t-factory:[a-z][a-z-]*$/`.
- [x] `src/core/reducer.ts` -- (a) `stage_completed` from BUILD is rejected unless every slice is CLOSED or CUT; (b) `step_issued` with `role` is rejected while another open step has that role; (c) `fold` catches a throw from `step()` and records `{id, kind, reason:'malformed: …'}` in `rejected`.
- [x] `src/store/load-run.ts` -- skip and report invalid commands/facts.
- [x] `src/cli/setup.ts` -- map a settings write failure to `SETUP_FAILED` and clean up the tmp file.
- [x] `test/reducer.test.ts`, `test/events.test.ts`, `test/store.test.ts`, `test/cli.test.ts` -- one test per I/O-matrix row. For the settings row, use a read-only settings dir (chmod 555), skipped when running as root.
- [x] `test/layers.test.ts` -- new. Scan imports in `src/**/*.ts` and assert AD-2: `core` imports only `core` (no `node:`); `store` imports only `core`, `store` and `node:`; the adapters (`cli`, `hooks`, `replay`, `dashboard/server`) never import one another.

**Acceptance Criteria:**
- Given the repo, when the Verification commands run, then all tests pass and tsc reports 0 errors.
- Given the three existing fixtures, when folded, then the snapshots are unchanged, or any regeneration is explained in Implementation Notes.
- Given a temp `FACTORY_HOME`, when `bin/factory setup` runs twice, then the second run reports no changes (existing test still green).

## Design Notes

Deferred (AD-29 edge cases): (1) two breakers that see the same dead owner can both rename, so the second may steal a lock a third process just acquired; (2) a holder that dies between `mkdir` and writing `owner.json` leaves a lock that never goes stale. Both need a crash in a tiny window, and the fix belongs with 1-2's real contention. Implementation appends one `deferred-work.md` entry.

Both `fold` (catch) and `loadRun` (validate) guard, on purpose. `fold` must be total for every caller, and `loadRun` reports bad lines as `skipped` rather than as rejections.

## Verification

**Commands:**
- `node --test test/` -- expected: all pass, 0 fail.
- `npm i --prefix "$TMPDIR/tsc" typescript@7.0.2 @types/node@22 && "$TMPDIR/tsc/node_modules/.bin/tsc" -p tsconfig.json --typeRoots "$TMPDIR/tsc/node_modules/@types"` -- expected: no output, exit 0.
- `shasum test/fixtures/*.state.json` before and after (no VCS here) -- expected: identical unless Implementation Notes explains a regeneration.

## Implementation Notes

- No fixture regeneration: the three `*.state.json` shasums are identical before and after, and no new rule rejects a scenario event.
- `fold` guard: rather than cloning state per event, `fold` runs `step()` in place and, if it throws, marks that index as malformed and replays from `from` without it. A throw partway through (e.g. `rework_requested` moves the slice, then spreading a non-array `voids` throws) leaves no partial mutation, and the normal path costs nothing extra. `apply` catches too and returns `ok:false, reason:'malformed: …'`, so its contract is unchanged.
- `loadRun` also skips a fact kind found in `commands.jsonl` and a command kind found in a facts file (`isFactKind` reuse), each reported in `skipped`. To give validation skips a real `offset`, `readLines` now returns `offsets` (one per item), which is an additive field.
- `appendLine`/`serialize` are now generic (`<T extends { data?: unknown }>`), not index-signature types, so typed `Envelope` interfaces still fit.
- The settings write wraps mkdir, backup copy, tmp write and rename. A read-only dir fails at the backup copy (EACCES); the message names the errno and says to run setup in your own terminal.
- AD-2 test: `test/layers.test.ts` also flags bare (non-`node:`, non-relative) imports and any `src/` file outside a known layer (`dashboard/web` excluded), and self-tests the checker on synthetic violations.
- Role-actor regex widened from the spec's `/^d2t-factory:[a-z][a-z-]*$/` to `/^d2t-factory:[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/` so the real role `reviewer-a11y` validates and `a-`/`a--b` are refused.
- Lock edge cases deferred: one entry appended to `_bmad-output/implementation-artifacts/deferred-work.md`.
- tsc verification: `npm i` hit EPERM on `~/.npm` in the sandbox, so it ran with `--cache "$TMPDIR/npm-cache"` added. Result: 0 errors. `node --test test/`: 39 pass, 0 fail (Node 26.11.1).

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-24): blind-hunter (B), edge-case-hunter (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| B10/E4 | Role-actor regex rejects digits (`reviewer-a11y`) and accepts `a-`/`a--b` | high | `reviewer-a11y` is a spine role (Consistency Conventions); `[a-z][a-z-]*` refuses it, so every a11y reviewer command would fail validation | patch: regex widened, tests added |
| E3 | `kind in REQUIRED` accepts `constructor`/`__proto__` | medium | `REQUIRED.constructor` is `Object`; `Object.entries(Object)` is empty, so the event validated and `loadRun` kept it | patch: `Object.hasOwn` + test |
| B6/E5 | Setup error prints `(undefined)` when no errno code | low | Direct correction | patch: falls back to error message |
| V1 | BUILD→WRAP with a CUT slice untested | medium (pre-verified) | Removing the CUT exemption kept 39/39 green | patch: test added |
| V2 | `loadRun` wrong-file branch untested | medium (pre-verified) | Deleting the branch kept 39/39 green | patch: test extended |
| V3/B7 | Setup tmp-file cleanup never exercised | medium (pre-verified) | Read-only dir fails at backup copy before tmp exists; no portable way to fail only the rename | defer |
| B2/E1 | Role guard can lock a role forever via an open step on a cut/voided/rerun slice | maybe-false (medium if true) | Voids name verified/gate/close events, not open steps; reruns are parked-only per AD-33; open question is whether 3-4's escalation always closes the builder step before a cut | defer |
| B1 | Global one-open-step-per-role is broader than AD-24 | false | AD-3 states "At most one open step per agent role per run" verbatim | reject |
| B3 | BUILD completion ignores open steps/asks; passes with empty slices | low / false | Empty slices in BUILD are impossible (`gate_2_passed` requires ≥1; reruns leave BUILD); open-step check not required by spec, fix adds a guard | reject |
| B4/E2 | Malformed events make `fold` O(n·k) | low | `loadRun` filters invalid lines first, so k≈0 in practice; fix adds per-event cloning | reject |
| B5 | Malformed rejected rows record `"undefined"` id/kind | low | Only for events with no id/kind; cosmetic | reject |
| E6 | Backup left after a failed write | false | The `.before-factory` backup is meant to persist once taken (existing idempotency test) | reject |
| B8 | Layers test skips the `dashboard/web` rule | low | No `dashboard/web` files exist yet; adding a check is new branching | reject |
| B9/E7/E8 | Import scanner misses `/*` in strings, `require()`, other extensions | low | `src` is ESM `.ts`/`.mjs` only by convention; no such strings today; fix adds parser complexity | reject |
| B11 | Fact-actor deferral not in deferred-work | low | Recorded in this spec's frozen I/O matrix as 1-3's job | reject |
| B12 | `loadRun` moved invalid commands to `skipped`; dedupe after validation | false | Both are the spec's intended behaviour (I/O matrix); a valid later duplicate winning over an invalid first line is better, not worse | reject |
| B13 | Bare `{"type":"module"}` files, no `engines` | false | Node floor is enforced by `bootstrap.mjs` (22.18 ≥ 20.11 needed for `import.meta.dirname`) | reject |
| B14 | Generic `serialize`/`appendLine` weakens typing | false | Same constraint as before for non-literal callers; no named harm | reject |
