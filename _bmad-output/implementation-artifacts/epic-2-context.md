# Epic 2 Context: Dashboard

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Add the local, read-only web dashboard (CAP-15, completing CAP-14's truth layer) on top of increment 1's event store. Every run shows as a swimlane of stage and slice cards. Every agent claim is marked CLAIMED, VERIFIED or UNVERIFIED, and every human decision (gates, escalations, cuts, merges, reworks) shows as a gold, human-attributed Decision seal. The board updates live without a reload. It is the interview's shared-screen proof that the factory's record cannot be advanced by the LLM's say-so, so d2t must be able to explain unaided why it is truthful. It is a window, not a cockpit: it has no write path.

## Stories

- Story 2.1: Dashboard server and projection
- Story 2.2: Dashboard board UI

## Requirements & Constraints

- A claim with no matching hook fact or evidence check displays as unverified. Gates, escalations and cuts appear as first-class, human-attributed events. The board updates live with no reload.
- The dashboard never gets its truth from LLM self-report. It runs as a tiny local process with no Docker and no required collector.
- It shows all runs across worktrees as lanes: stage, current slice, reviewer verdicts and the Needs You queue.
- It is read-only. The only interactions are copying a command, opening or closing evidence, toggling reduced motion, and (in replay) the replay controls. Drag and drop, inline edits, modals, toasts that hide cards, and any button that writes to the truth layer are banned.
- Lost liveness (SIGNAL LOST) appears on the dashboard only and never pages the human in chat.
- Success signal: in the dry run, every stage and verdict on the board shows as verified.

## Technical Decisions

- **AD-1 (one fold).** The server builds its projection with the same `loadRun` and reducer the CLI uses. State is the fold of `commands.jsonl`; facts feed only the claim overlay. `cache.sqlite` is a cache only: deleting it must rebuild the same board, minus the live-only overlays.
- **AD-2/19 (layering).**
  - `src/dashboard/server` imports only `core` and `store`, never another adapter. It uses Node built-ins only: `node:sqlite` (unflagged from 22.13; avoid `createTagStore`), `fs.watch` and `http`.
  - `src/dashboard/web` imports nothing from `src/`. It talks to the server only through HTTP GET and SSE.
  - Only `web` has npm dependencies (Svelte 5.57.2, Vite 8.3.5, @sveltejs/vite-plugin-svelte 7.3.1). Its `package.json` and lockfile live in `src/dashboard/web`, never at the plugin root.
  - `dashboard/dist/` is committed. If it is missing, a fallback build writes to the plugin data directory. Nothing writes under `${CLAUDE_PLUGIN_ROOT}`.
- **AD-16 (a singleton, read-only server).**
  - **Process.** One process per machine, bound to `127.0.0.1:<dashboard_port>`. The port defaults to 4870 and comes from plugin `userConfig` via `plugin-env.json`. Never use 4317, the OpenTelemetry default.
  - **Locking.** The port bind is the lock. After binding, the server writes `~/.factory/dashboard.pid` as `{pid, plugin_version, root}`.
  - **Startup.** `factory start` and `resume` start the server detached and restart it on a version mismatch. Both return `dashboard_url`, and there is also a `factory dashboard` verb. A foreign `EADDRINUSE` is reported, never assumed to be ours.
  - **Host check.** Requests are rejected unless `Host` is `127.0.0.1:<port>` or `localhost:<port>`.
  - **Data.** The server is the only opener of `cache.sqlite`. It tails `~/.factory/*/runs/*/{commands.jsonl,facts/*.jsonl}` with recursive `fs.watch` plus a 2 s poll, tracking byte offsets.
  - **Reading files.** All reads go through `store/jsonl.ts` (AD-28): consume up to the last `\n`, skip and log unparsable lines, and de-duplicate by `id`. Commands are ordered by file order, facts by `(ts, id)`.
  - **Routes (GET only).**
    - `/api/board` returns `{cursor, projection}`.
    - `/api/stream?since=` is SSE and honors `Last-Event-ID`.
    - The SPA is served at `/`.
    - `/replay/<name>` and `/api/recordings/<name>` (404 `RECORDING_NOT_FOUND`) are AD-16 routes, but replay itself is built in epic 4.
- **Deadlines and constants (AD-16/17/21).**
  - The projection carries absolute deadlines (`overdue_at`, `cut_at`, `ends_at`, `timebox_ends_at`, `signal_lost_at`). The browser only compares them with its clock and never holds thresholds.
  - `now` sets flags only (`overdue`, `at_risk`, `timebox_exceeded`, `signal_lost`). Every transition is a CLI-appended command.
  - The constants come only from `core/config.ts`: `CLAIM_OVERDUE_MS` 30 s, `HEARTBEAT_INTERVAL_MS` 60 s, `SIGNAL_LOST_MISSED` 3.
  - **SIGNAL LOST** is a live-only overlay, applied only in working states. It fires when there has been no command or fact for 3 × 60 s **and** no session bound to the run appears in `claude agents --json` (idle counts as live). Replay derives it from event gaps alone.
- **AD-7 (claim overlay).** `core/verify.ts` is the only home of the attribution and verification join, so the dashboard reuses it rather than writing its own.
  - The overlay applies only to `reported` steps:
    - CLAIMED: evidence is pending and the claim is younger than `CLAIM_OVERDUE_MS`;
    - VERIFIED: the CLI has appended `step_verified`;
    - UNVERIFIED: the claim is overdue.
  - Tests, health and slice close are verified by the CLI's `check_ran`. A builder-run test seen by a hook is only "supporting".
- **AD-23 (event data only).** Everything the board shows comes from command `data`: the slice list with roster and dependencies, gate check rows, the assumptions count, escalations (`E<n>`, label, line), findings, verdicts and merge resolutions. The dashboard never reads `artifacts/`.
- **AD-34 (cards).** Needs You card content (`type`, `title`, `reason_label`, `reason`, `commands[]`) comes from `core/cards.ts`, the same function `next` uses, so chat and board match verbatim. `ask_raised.data.card` records it.
- **AD-5/33 (vocabulary and voids).**
  - Stage enum: `INTAKE | RECON | FRAME | SCAFFOLD | SPEC | DESIGN | SLICE_PLAN | BUILD | WRAP`. The reducer's `ORIENT` and `SPEC_DESIGN` map to it.
  - The Decision drawer's event row shows the real AD-5 decision kind, for example `gate_2_passed` or `escalation_ruled`.
  - Voided events (`data.voids` on rework or rerun) show as superseded.
- **Spine overrides of the UX docs.**
  - Cards show `card.commands`. `/factory resume` appears only for SIGNAL LOST or an unbound session.
  - Run IDs look like `<slug>-<base32×4>`, not `r-7f3a`.
  - The Decision drawer's "terminal response" is the `prompt_text` verbatim.
  - `recon`, `framer`, `scaffolder`, `spec-writer` and `slicer` are drawn as the conductor.
  - Verdict first lines come in only two forms: `VERDICT: APPROVE|FINDINGS|ESCALATE` and `STATUS: DONE|ESCALATE`.

## UX & Interaction Patterns

- **Board layout.**
  - The top bar is sticky and holds the brand, the Mode badge (`LIVE`, or `OFFLINE · reconnecting`), the Truth legend (CLAIMED · VERIFIED · UNVERIFIED) and the Reduce-motion toggle.
  - There are five columns: Backlog · In Progress · In Review · NEEDS YOU · Done. Headers are sticky and show board-wide counts. Master d2t sits in the Needs You header.
  - Each run is a swimlane, newest on top. Its header shows the run id, title, origin tag, stage, Budget clock and Stage track (with gate diamonds).
- **Cards.**
  - Stage cards are holo-plates. Slice cards are datapads.
  - Needs You cards have a type tag (`GATE`, `ESCALATION`, `CUT`, `MERGE`, `SIGNAL LOST`), a REASON block with a bold reason label, and an Action slot holding the command and a Copy button.
  - Decision seals persist forever. When a card collapses into the Done deck, its seals move to the deck's seal row. Beyond 5 Done items, the 4 newest stay visible and the rest collapse into a `+N` deck.
- **Evidence drawer.** It docks on the right and narrows the board, never overlaying it. It has two variants: Claim (proof table plus CLAIMED → VERIFIED chain) and Decision (event, reason, decided by, at, terminal response, run/stage, evidence checked). It closes with `×` or `Esc`, and focus returns to the source.
- **States.**
  - Cold load: render the chrome immediately and lanes as data arrives, with no spinners and no skeletons.
  - No runs: `NO RUNS YET` plus `/factory [task]`.
  - Offline: freeze the board, dim it to 90%, and resync without a reload when the connection returns. This is not styled as danger.
  - Empty cells explain what will fill them, for example `AWAITING GATE 1`.
- **Motion.**
  - State changes are instant. Animation is decorative only.
  - Event animations last ≤ 600 ms. Bursts coalesce within 250 ms.
  - Reduce motion comes from the toggle (remembered per browser) or the OS setting, and stops all non-essential motion.
- **Visual system.** It is dark only, desktop at ≥ 1440 px (narrower viewports scroll horizontally), with system font stacks only.
  - Color roles: gold belongs only to d2t (decisions, Needs You and VERIFIED), cyan to agents and CLAIMED, danger red-orange only to UNVERIFIED and SIGNAL LOST, and amber only to budget pressure.
  - Use the DESIGN.md tokens and its "Mock deviations — spine wins" list, not raw hex from the mocks.
  - Placeholder sprites are 16×16 inline SVG with 2-frame idles, using the original character roster. No Star Wars IP.
- **Accessibility.**
  - Every state has a text label.
  - Sprites are `aria-hidden`.
  - Every control is keyboard-reachable and shows a 2px holo focus ring.
  - Each swimlane is a labeled region.
  - New Needs You cards are announced through `aria-live` (polite, coalesced within 1 s).

## Cross-Story Dependencies

- Both stories build on epic 1's `core` (reducer, `verify.ts`, `cards.ts`, `config.ts`, events), `store` (`paths.ts`, `jsonl.ts`, `loadRun`) and hook facts. If any of these lack data the board needs, the fix is to embed more projection data into commands (additively, within `v:1`), never to read artifacts.
- 2.2 depends on 2.1's `/api/board` projection shape and its SSE stream.
- Epic 3 adds cut, designer, multi-slice, escalation and budget-clock events that the board must render. Epic 4 builds replay (the Replay bar, `/replay/<name>` and recordings) and folds the same projection per event. Epic 5 brings concurrent lanes.
