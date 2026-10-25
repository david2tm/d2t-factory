---
title: 'Replay engine for single-run recordings'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** WRAP already writes redacted recordings, but `/api/recordings/<name>` answers 501. `/replay/<name>` serves the live board, with no playback. So d2t can't replay a recorded run on demand, and has no fallback when a live demo stalls (CAP-16 single-run).

**Approach:** The server folds a recording through the existing `loadRun` → `fold` → `projectRun` path (AD-1, AD-18). It serves one ordered timeline: every event with its post-event lane, plus the deadlines. The SPA at `/replay/<name>` replaces the SSE stream with a playback clock. It reuses the board as is, and adds the Replay bar, the replay states and the replay keyboard and a11y rules from EXPERIENCE.md. Every deadline is compared against the playback clock, never wall time. SIGNAL LOST comes from event gaps alone.

**Decisions (2026-10-25):**
- **Transcripts are not served.** Replay serves events only. "Redacted transcripts" is held by a test: no file in any fixture recording contains a `redact.json` value or a secret pattern. Transcripts get no UI.
- **Synthetic fixtures.** These go in `test/fixtures/recordings/`:
  - one recording built from each reducer fixture: `happy-path`, `findings-escalation-rework` and `illegal-then-abandon`, each written through `writeRecording` under a temp `FACTORY_HOME`;
  - one captured from the 1-5 pipeline acceptance harness.

  A real interactive recording is deferred (deferred-work.md).

## Boundaries & Constraints

**Always:**
- **Same projection.** At every playhead, each lane deep-equals `projectRun` over that run's events up to the playhead, plus the SIGNAL LOST overlay evaluated at the playback clock.
- **Recording only.** Replay reads `recordings/<name>/` alone, through `src/store/paths.ts`. It never reads live `runs/`, `artifacts/` or `transcripts/`.
- **GET only.** The server stays GET-only and Host-checked. Replay adds no write path and no SSE.
- **Built-ins only.** Node built-ins only, with no new npm dependencies. AD-2 import direction holds.
- **No second redactor.** There is no new redaction code (AD-14).
- **Frozen fixtures.** Folded snapshots of committed fixture recordings stay byte-identical (AD-32), and the existing `test/fixtures/*.state.json` don't change.
- **Not single-run.** Ordering, pips and labels don't assume a single run, because epic 5 adds concurrent lanes.

**Never:**
- Multi-run recording or concurrent-lane UX polish. That is epic 5.
- Idle-gap compression. Speeds are 1×, 4× and 16× of real time.
- Writing to or rewriting a recording.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Serve | `GET /api/recordings/<name>`, valid v:1 manifest | 200: `{name, recorded_at, start, end, signal_lost_ms, runs[], events[], frames[]}` (Design Notes) | — |
| Missing / bad | no dir, unsafe name, unreadable or invalid manifest, `v` ≠ 1, or no valid event | 404 `RECORDING_NOT_FOUND` with a reason message | Browser: not-found state |
| Torn or bad lines | invalid JSONL lines in the recorded run | Skipped and counted in `lane.skipped`, never folded | — |
| Opened | `/replay/<name>` loads | Badge `REPLAY · loading` → `REPLAY · recorded <YYYY-MM-DD>`. Paused at `00:00:00`. Board shows events with `at ≤ start` | Controls `aria-disabled` while loading |
| Gap | playhead ≥ last event `at` + `signal_lost_ms` on a working lane | SIGNAL LOST card in Needs You, `live.signal_lost: true` | Ends at the next event of that run |
| Seek with drawer | drawer open on a claim, decision or card absent at the new playhead | Drawer closes; focus → timeline | Claim present but not yet verified → it shows CLAIMED |
| End | playhead reaches `end` | Pauses at last event. Play restarts from `00:00:00` | — |
| 16× | playing at 16× | Card glide and agent walk skipped. Needs You announcements suppressed; on pause `Needs You: N cards` | — |

</frozen-after-approval>

## Code Map

- `src/store/load-run.ts` -- `loadRun(hash, run)` reads via `commandsFile`/`factsDir`. Extract the body into `loadRunFiles(commandsPath, factsDirPath)` so a recorded run loads through the same code. `readEvents`, dedupe, and `(ts,id)` fact order are reused unchanged.
- `src/store/paths.ts` -- already has `recordingDir`, `recordingManifest` and `recordingRunDir`. Add `recordingCommandsFile` and `recordingFactsDir`. This is the only place recording paths are resolved.
- `src/core/projection.ts` -- `projectRun(RunInput, {repo_hash, run_id})` and `projectBoard` are reused as is. It reads facts only via `byId` (evidence rows) and `last` (`last_event_at`, `signal_lost_at`). That makes the frame-reuse rule in Design Notes exact.
- `src/core/cards.ts` -- `signalLostCard(runId)`: the card replay shows on a gap.
- `src/core/config.ts` -- `HEARTBEAT_INTERVAL_MS × SIGNAL_LOST_MISSED` = `signal_lost_ms`.
- `src/dashboard/server/http.ts` -- the `/api/recordings/` branch is the 404/501 stub to replace. `isSafeId` is imported from store.
- `src/dashboard/server/main.ts` -- `withLive` is how the live overlay is shaped: `needs_you` plus `{ask_id:'signal_lost', raised_at: signal_lost_at, card}` and `live`. Mirror that shape exactly.
- `src/cli/record.ts` -- the writer of the layout. Don't change it.
- `src/dashboard/web/src/App.svelte` -- calls `connect()` from `lib/stream.ts`. It handles the `clock` derivation, Needs You announce/look-up, the lane-gone drawer close, and Esc.
- `src/dashboard/web/src/components/TopBar.svelte` -- the Mode badge (`live|offline`) is extended with the replay states.
- `src/dashboard/web/src/lib/{glide,motion,announce,drawer,model,types}.ts` -- `isReduced()` gates glide and streak. `eventName()` gives pip labels. `types.ts` mirrors core types (a copy, never an import).
- `DESIGN.md` (`replay-bar`, `replay-height` 86px, `gold-2` future pips, `dot-replay`) and `mockups/key-dashboard.html` Replay bar -- the visual source. The spine wins on port and route.
- `test/dashboard.test.ts:184-215` -- asserts 501 for a `{}` manifest. That becomes a 404.
- `test/fixtures/generate.ts`, `test/projection.test.ts`, `test/web-model.test.ts` -- fixture and snapshot patterns (`UPDATE_SNAPSHOTS=1`). `test/layers.test.ts` enforces AD-2.

## Tasks & Acceptance

**Execution:**
- [x] `src/store/paths.ts`, `src/store/load-run.ts` -- add the recording path helpers and `loadRunFiles`. `loadRun` delegates to it, with no behavior change.
- [x] `src/store/recording.ts` (new) -- `loadRecording(name)` returns `{manifest, runs: {repo_hash, run_id, loaded}[]}` or `{missing: reason}`. It validates the name, the manifest shape (`v === 1`, safe ids) and the run dirs.
- [x] `src/core/timeline.ts` (new, pure) -- `buildTimeline(manifest, runs)` returns the response in Design Notes: merge order, frame reuse and dedupe, decision flags, per-run `signal_lost_card`.
- [x] `src/dashboard/server/http.ts` -- serve it. Memoize per name plus manifest mtime, holding at most 8 recordings. 404 `RECORDING_NOT_FOUND` with a reason.
- [x] `src/dashboard/web/src/lib/types.ts`, `lib/replay.ts` (new, pure) -- add the `Recording` types. Add `boardAt(rec, ms)`, which applies the `last_event_at`/`signal_lost_at` overrides and the SIGNAL LOST overlay and returns lanes in `projectBoard` order. Add `pips(rec)` and `prevPip`/`nextPip`.
- [x] `src/dashboard/web/src/lib/playback.ts` (new) -- the playback store. It fetches the recording and runs a rAF clock: play, pause, seek, speed, and end-pause, with restart from 0 on play at the end. It exposes `fast` (16× while playing), which glide and the agent walk read to skip travel.
- [x] `src/dashboard/web/src/components/ReplayBar.svelte` (new), `App.svelte`, `TopBar.svelte`, `lib/glide.ts`, `lib/tokens.css` -- route on `location.pathname` (`/replay/<name>` means no SSE). Add the loading, not-found, opened and ended states, plus the Replay bar per DESIGN.md (labeled landmark `Replay controls`). Drawer validity on seek, the `Space`/`←`/`→` shortcuts (never on native controls), and the 16× announce rules.
- [x] `test/fixtures/recordings/` + `test/fixtures/generate.ts` -- the fixture recordings from the Decisions. The generator gets a deterministic `recorded_at`, and the recordings are committed. Each `<name>.timeline.json` is a snapshot of the `buildTimeline` output.
- [x] `test/timeline.test.ts`, `test/web-replay.test.ts` (new), `test/dashboard.test.ts` -- cover the matrix, the equivalence AC, the snapshot, isolation, and the 404 cases.
- [x] `dashboard/dist` -- rebuild with `npm run build` in `src/dashboard/web` so that `web-build.test.ts` passes.

**Acceptance Criteria:**
- **Projection equivalence.** Given each fixture recording, when `boardAt(rec, at_i)` is taken for every event index *i*, then each lane deep-equals `projectRun(loadRun-prefix up to i)` with `live: {signal_lost:false}`.
- **Fixture snapshots.** Given the committed fixture recordings, when the tests run, then every `buildTimeline` snapshot is byte-identical.
- **Recording isolation.** Given a live run and a recording of the same run id under one `FACTORY_HOME`, when the live run is deleted or appended to, then `/api/recordings/<name>` is unchanged.
- **Decision pips.** Given a recording with gates, an escalation, a cut, a rework and the merge, when it is opened, then there is exactly one gold pip per decision event. `next decision` from `00:00:00` pauses on the first pip, and the board then shows that decision's seal.
- **Replay controls.** Given replay mode, when focus is on a speed radio and `→` is pressed, then the speed changes and the playhead doesn't move.
- **No secrets.** Given the fixture recordings, when every file under them (transcripts included) is scanned, then no `redact.json` value and no secret pattern appears. The `/api/recordings/<name>` body holds nothing read from `transcripts/`.

## Implementation Notes

- **Tie order (2026-10-25).** The Design Notes' "first command whose `ts` > the fact's" contradicted "on a tie the fact comes first". Implemented as fact-first on a tie: a fact goes before the first command with `ts` ≥ its own, so a command citing a fact sees it. `runOrder` in `src/core/timeline.ts`.
- **Decision-pips AC.** No single fixture has gates, an escalation, a cut, a rework and the merge, so the AC is held across the fixtures together. `findings-escalation-rework` has the escalation, cut and rework. `happy-path` and `pipeline-acceptance` have both gates and the merge.
- **Cited-fact frames.** The reducer fixtures cite `fact-stop`/`fact-output`, which are not fact events, so their recordings hold only uncited facts. The cited-fact path is covered by `pipeline-acceptance` and a hand-built case in `test/timeline.test.ts`.
- **`pipeline-acceptance` manifest.** It keeps its captured manifest `name` (the run id `add-a-footer-8wkk`), so the timeline's `name` differs from the directory name. Re-capture with `CAPTURE_RECORDING=1`.
- **Out-of-list file.** `src/dashboard/web/src/lib/sprites.ts` gained the prev/next/play/pause glyphs for the Replay bar.
- **Svelte-only behaviour.** The badge text, focus moving to the timeline after a drawer close, the 16× announcement suppression and the glide skip live in components, and the repo has no component-test harness. The pure logic under them is unit-tested, and the rest was checked by hand in a browser.
- **Verification.** `node --test test/`: 315 pass and 20 skipped in the sandbox (no local port binding). `dashboard`, `pipeline` and `web-build` re-run outside it: 59/59 pass. The reducer `*.jsonl` and `*.state.json` fixtures are byte-identical to the baseline.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence / route |
|---|--------|---------|---------|------------------|
| 1 | blind, edge | `load()` fetch race: a late response reopens after `close()` or a second `load()` | low | Real, but `load` runs once per page and unmount is page teardown. Needs a new guard → rejected |
| 2 | blind | rAF step uncapped after a backgrounded tab | low | The playhead keeps real-time clock semantics, so only the jump size at 16× is cosmetic. Fix adds guards → rejected |
| 3 | blind, edge ×2 | Symlinked `recordings/<name>`, manifest or run files escape the run-dir realpath check | low | Real, but `factory record` never writes symlinks (`copyTree` skips them), so a link has to be planted by hand. Fix adds per-file guards → rejected |
| 4 | blind | `buildTimeline` is superlinear and blocks the server on first request | medium | Measured: 116 cmds 202 ms. One `projectRun` is quadratic because `trace()` calls `apply()`, and `apply` runs `structuredClone` (reducer.ts:397) on every command, so a timeline build is roughly cubic. Estimate 3–12 s at 300–500 cmds → **patch** (trace folds once, snapshots only at decisions) |
| 5 | blind | Cache bounded by count, not bytes; no gzip | low | About 0.4 MB per 116-command recording, 8 entries → rejected |
| 6 | blind | Every failure shows RECORDING NOT FOUND | low | As specified: the matrix maps any 404/unusable body to the not-found state. Server-down is rare → rejected |
| 7 | blind | `role=slider` timeline has no arrow stepping; ←/→ jump decisions | low | ←/→ still move the slider value (to decision pips), as EXPERIENCE assigns. Fix adds a key branch → rejected |
| 8 | blind | `isNativeControl` checks tag names only | false | No focusable non-native interactive element exists (grep: only `h3 tabindex=-1`, plus `role=status`/`group`) |
| 9 | blind | Decisions sharing one ms are unreachable by prev/next | low | Needs two human decisions in the same ms → rejected |
| 10 | blind | No message when the board is empty before `run_started` | low | An empty board is the log at that instant (matrix: Opened) → rejected |
| 11 | blind | Seeks at 1×/4× announce cards and glide | low | Spec scopes suppression to 16× playing → rejected |
| 12 | blind | Dragging while playing fights the clock | low | Cosmetic → rejected |
| 13 | blind | Frame reuse rests on `citedIds` seeing every fact read | false | `projectRun` reads facts only via `byId` (evidence rows) and `last`. Claim evidence is `step_verified.data.evidence` (verify.ts:126), which `citedIds` covers |
| 14 | blind | Type copy drift; `valid()` skips index range checks | low | `types.ts` copy is the established pattern, and the server builds the indices → rejected |
| 15 | blind | `CAPTURE_RECORDING` refresh is nondeterministic | low | A deliberate manual refresh followed by `UPDATE_SNAPSHOTS` → rejected |
| 16 | blind | `recordedDay` test accepts either of two dates | low | TZ-dependent by design; the rest of the tests merge into 17–19 → rejected |
| 17 | verification-gap | Playback rAF `tick` loop never runs in tests | medium | Pre-verified gap → **patch** (stub rAF, drive frames) |
| 18 | verification-gap | Glide/streak skip at 16× untested | low | Pre-verified gap; direct test → **patch** |
| 19 | verification-gap | `App.svelte` replay wiring (clock, 16× announce, drawer focus) untested | medium | Pre-verified gap with no component harness → **defer** |
| 20 | verification-gap | HTTP isolation asserts are served from cache | low | `timeline.test.ts` isolation covers it through `loadRecording` → rejected |
| 21 | edge | Bad run files (`facts/` a file, unreadable jsonl) throw inside the request handler | medium | `readdirSync`/`openSync` throw, and the server has no handler, so the dashboard singleton dies → **patch** (catch → 404) |
| 22 | edge | Cache stale if run files change under the same manifest mtime | low | Recordings are immutable once written → rejected |
| 23 | edge | `ts` that passes `TS_RE` but isn't a date (month 13) | low | Writers emit `toISOString()` → rejected |
| 24 | edge | Duplicate decision ids across runs break the keyed each | low | Fix is a direct key correction → **patch** |
| 25 | edge | Held key auto-repeat toggles playback | low | Fix adds a guard → rejected |
| 26 | edge | `/replay/` not-found text has a blank name | low | Fix adds a branch → rejected |
| 27 | edge | AC: `boardAt(at_i)` includes later events tied at the same `at` | false | A time-based playhead applies every event at that instant (matrix: "events with at ≤ start"), and the equivalence test uses the same tie-inclusive prefix |

## Design Notes

**Placement (AD-2 over the spine's `src/replay/`).** The dashboard server serves the route, and adapters can't import each other. So the pure fold goes in `core/timeline.ts` and the reader in `store/recording.ts`. `src/replay/` is not created. Every piece still uses only `store` and `core`.

**Order.** Per run, commands stay in file order. Facts, in `(ts,id)` order, are inserted before the first command whose `ts` > the fact's `ts`, so on a tie the fact comes first. Each event's `at` is the running max of `ts` within its run, so the timeline is monotone. Runs are merged by `at`, with manifest order breaking ties. `start` and `end` are the first and last `at`.

**Frames.**
- The response shape is:
  ```
  events: [{id, kind, at, run, decision, frame}]
  frames: Lane[]
  ```
  - `run` indexes `runs[]`.
  - `frame` indexes `frames`, the run's post-event lane.
- A frame stores `last_event_at` and `deadlines.signal_lost_at` as `null`. The browser restores them from the playhead:
  - `last_event_at` is the `at` of the run's latest applied event.
  - `signal_lost_at` is `last_event_at + signal_lost_ms` when the lane is neither terminal nor parked.
- A fact that no command cites (any `data.evidence` id) can change only those two fields. It therefore reuses the previous frame without re-projecting, which keeps the work O(commands × n) and the payload about one lane per command.
- Identical frames are deduped by JSON.

## Verification

**Commands:**
- `node --test test/` -- expected: all pass, including layers, web-build, and unchanged `*.state.json`.
- `cd src/dashboard/web && npm run build` -- expected: `dashboard/dist` regenerated with no diff on a second build.

**Manual checks:**
- Open `/replay/<fixture>` on a dashboard started with the fixture copied into `FACTORY_HOME/recordings/`. Step through every pip, seek with the drawer open, play to the end at 16×, then reload a bad name.
