# Epic 4 Context: Replay Engine for Single-Run Recordings

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Make a recorded real run playable in the dashboard (CAP-16, single-run). Increment 1 already writes redacted recordings with `factory record` at WRAP, but `/api/recordings/<name>` returns only 404 or 501, and `/replay/<name>` serves the board with no playback. This epic folds a recording through the same reducer the live board uses, serves the per-event projections, and adds the Replay bar so d2t can play, pause, seek and jump between human decisions on a playback clock. It matters for two reasons. First, the success signal requires d2t to replay a recorded session on demand and explain the truth layer from it. Second, replay is the fallback when a live demo stalls. Multi-run replay (concurrent lanes) waits for epic 5, because parallel runs don't exist yet.

## Stories

- Story 4.1: Replay engine for single-run recordings

## Requirements & Constraints

- **Fidelity.** Replaying a recorded run reproduces its lanes and its human decisions: gates, escalations, cuts, reworks and the merge, all as gold, human-attributed seals. At the playhead, board state always equals the event log up to that instant.
- **No secrets.** Replayed content, transcripts included, contains no secrets. Redaction scope includes gitignored files the CLI copied into the worktree, such as `.env`.
- **Isolation from live.** Replay reads only `recordings/<name>/`, never the live `runs/`.
- **Read-only.** Replay adds no write path. The only interactions are the replay controls, opening or closing evidence, copying a command, the reduced-motion toggle, and the `Open the live board` link.
- **Recordings are regression fixtures.** Every recording's folded snapshot must stay byte-identical unless a change is deliberate. Recordings from increments 1–3 must still load.
- **Making recordings.** Record only in interactive sessions, never with `claude -p`, because `-p` teardown drops async facts.

## Technical Decisions

- **AD-18: recordings are event trees, and replay folds them.** There is no separate replay engine.
  - **Recording layout.** `factory record <name> [--runs …]` writes `recordings/<name>/`:
    - `manifest.json {v, name, recorded_at, plugin_version, runs[]}`;
    - `runs/<repo-hash>/<run-id>/…`, the redacted JSONL tree (commands, facts, artifacts; never `redact.json`, locks or dev-server files);
    - `transcripts/<session>[-<agent>].jsonl`, redacted line by line.
  - **Serving.** `/api/recordings/<name>` returns the ordered events, each with its post-event projection and deadlines, all produced by the AD-1 reducer. A missing recording returns 404 `RECORDING_NOT_FOUND`.
  - **Playback clock.** The browser plays, pauses and seeks on its own clock. Absolute deadlines (`cut_at`, `ends_at`, `timebox_ends_at`, `overdue_at`, `signal_lost_at`) are compared with the playback clock, never with wall time.
- **AD-1: one reducer, one record.** The CLI, the dashboard server and replay share `loadRun` and the reducer.
  - Run state is the fold of `commands.jsonl` alone. Facts feed only the claim overlay.
  - Commands embed the facts they rely on, or name them by `id`, so replay never re-matches.
  - The claim overlay (CLAIMED / VERIFIED / UNVERIFIED) must also be reproduced at the playhead.
- **AD-17 / AD-21: time.**
  - `now` only sets flags (`overdue`, `at_risk`, `timebox_exceeded`, `signal_lost`). Time-driven transitions are already recorded as commands.
  - SIGNAL LOST in replay comes from event gaps alone: no event for `SIGNAL_LOST_MISSED × HEARTBEAT_INTERVAL_MS`. It never comes from `claude agents --json`.
  - Facts are ordered by `(ts, id)`, and that order is for display only.
- **AD-14: redaction is single-sourced.**
  - `src/core/redact.ts` is pure and idempotent. It runs at write time in every writer and again at `factory record`.
  - Its inputs are the secret patterns plus the values in `runs/<run-id>/redact.json` (mode 0600, never recorded).
  - Replay must not add a second redactor.
- **AD-32: schema evolution.**
  - Within `v:1`, changes are additive only.
  - A breaking change bumps `v` and ships `src/core/upcast.ts`. Recorded files are never rewritten.
  - Tests use `node:test`. The reducer is tested on fixture JSONL, and recordings are fixtures.
- **Placement and dependencies (AD-2, AD-19).**
  - The code goes in `src/replay/`, which depends only on `src/store` and `src/core`, and uses Node built-ins only.
  - The Svelte web app talks to the server over HTTP GET only.
  - Only `src/store/paths.ts` resolves `recordings/`.
- **AD-16: routes.** The SPA is served at `/replay/<name>`. The server accepts GET only and checks the `Host` header.
- **AD-23: board data comes from events only.** The board and replay never read `artifacts/`.

## UX & Interaction Patterns

- **Entry and mode badge.**
  - Entry is `127.0.0.1:<port>/replay/<recording>`.
  - The Mode badge reads `REPLAY · loading`, then `REPLAY · recorded <date>`.
  - While loading, there is no spinner. The Top bar and column headers render, lanes appear once the recording is parsed, and the Replay bar shows with its controls `aria-disabled`.
- **Recording not found.** This covers a missing name or a malformed URL.
  - The badge shows a bare `REPLAY`.
  - The board shows a centered Empty cell, `RECORDING NOT FOUND` / `No recording named <recording> on this machine.`, plus an `Open the live board` link to `/`.
  - The Replay bar is hidden.
- **Opened.** Playback is paused at `00:00:00`, with no autoplay. When the recording ends, playback pauses at the last event, and pressing play restarts from `00:00:00`.
- **Replay bar.** It is a sticky footer, 86px high. Controls, from left:
  - `prev decision`, then play/pause (a 44px round button with a cyan rim), then `next decision`;
  - the speed radio group `SPEED 1× 4× 16×`, with the active segment solid holo;
  - a 6px timeline track with the played portion in cyan;
  - the time readout `REPLAY TIME hh:mm:ss / hh:mm:ss`.
- **Timeline pips.** Gold diamond pips mark human decisions, and future ones use `gold-2`. Mono labels alternate above and below, for example `Gate 1 · <run-id>`. The playhead is a white line with a cyan knob. Diamonds mean human decisions only.
- **Controls.**
  - `prev decision` / `next decision` jump to the adjacent gold pip and pause there.
  - Clicking or dragging the timeline seeks.
  - In replay only, `Space` plays or pauses and `←`/`→` move to the previous or next decision. Shortcuts never fire while focus is on a native control.
- **Seeking with the Evidence drawer open.** The drawer reflects the playhead, so a claim can revert to CLAIMED. If the drawer's source card or seal doesn't exist at the playhead, the drawer closes and focus moves to the timeline.
- **Motion.**
  - At `16×`, travel animations (card glide, agent walk) are skipped and items jump.
  - At `1×` and `4×`, animations play at normal duration and are not scaled.
  - State is never animated into existence.
- **Accessibility.**
  - The Replay bar is a labeled landmark, `Replay controls`.
  - At `16×`, `aria-live` Needs You announcements are suppressed during play. On pause, one summary is announced instead, for example `Needs You: 3 cards`.
  - Tab order runs top bar → lanes → drawer → replay bar.
- **Color.** Red-orange is never used for a recording (REC) dot.

## Cross-Story Dependencies

- **Builds on epic 1.**
  - Increment 1 built `factory record` (`src/cli/record.ts`) and `core/redact.ts`, and WRAP writes a recording named `<run-id>` after `run_completed`, so a replay ends COMPLETED.
  - Known gap from 1-5 review: `record --runs a,b` with a shared session redacted that session's transcript with only the first run's values. The fix was a union of all runs' values; confirm it before epic 5.
- **Builds on epic 2.**
  - Epic 2 built the projection, the board components, the `/replay/<name>` SPA route and the `/api/recordings/<name>` stub, which still returns 501 when the recording exists.
  - Replay reuses the board as is. Only the Replay bar, the playback clock and the replay states are new.
- **Builds on epic 3.** All epic 3 events must replay: cut, designer, multi-slice, escalation, rework/rerun voids, and the budget clock.
- **Fixtures.** No real recording exists under `~/.factory/recordings/` yet. The current fixtures are synthetic JSONL in `test/fixtures/`. At least one real interactive increment 1–3 recording has to be made before it can serve as a regression fixture.
- **Feeds epic 5.** Epic 5 adds multi-run recording and concurrent lanes in replay, which is what UX Flow 2 and the mockup depict. This epic needs only one lane, but the event ordering and the timeline labels should not assume a single run.
