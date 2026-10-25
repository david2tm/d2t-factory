---
title: 'Dashboard board UI'
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-d2t-factory-2026-10-23/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-d2t-factory-2026-10-23/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The 2-1 server serves a live claimed-vs-verified projection (`/api/board`, `/api/stream`), but `/` still shows a placeholder page. Nobody can see the lanes, claim chips or Decision seals, so the interview's shared-screen proof does not exist yet.

**Approach:** Build the read-only Svelte 5 board in `src/dashboard/web`, following DESIGN.md, EXPERIENCE.md and the mockups (the spine wins where they conflict). It has run lanes, five columns, stage and slice cards, claim chips, seals, Needs You cards, a Done deck, an evidence drawer, the cold-load, no-runs and offline states, placeholder sprites and motion. Vite builds it into the committed `dashboard/dist`, which the 2-1 server already serves.

## Boundaries & Constraints

**Always:**
- `src/dashboard/web` imports nothing from `src/` outside itself. It talks to the server only through `GET /api/board` and `EventSource('/api/stream?since=<cursor>')`. Its npm deps are exactly `svelte@5.57.2`, `vite@8.3.5` and `@sveltejs/vite-plugin-svelte@7.3.1` (exact pins, dev deps), with `package.json` and the lockfile inside `src/dashboard/web`.
- Everything shown comes from the 2-1 `Lane` shape. The browser holds no thresholds. It only compares projection deadlines with its own clock: a `claimed` chip past `overdue_at` renders UNVERIFIED (`UNVERIFIED · no hook fact`).
- Use DESIGN.md tokens (as CSS custom properties) and its "Mock deviations" list (D:667–685), never raw mock hex. Dark only, system font stacks, 1440px target (narrower viewports scroll horizontally).
- Color roles: gold only for d2t, decisions, Needs You and VERIFIED; cyan for agents and CLAIMED; danger only for UNVERIFIED and SIGNAL LOST.
- Needs You cards show `card.commands` verbatim (spine override). Run ids are shown as given.
- Every state has a text label. Sprites are `aria-hidden`. Every control is keyboard-reachable with a 2px holo focus ring. Each lane is a region labeled `Run <run-id>`, and the drawer is labeled `Evidence drawer`.
- State changes render instantly. Event animations last ≤ 600 ms, and bursts on one card coalesce within 250 ms. Reduce motion comes from the toggle (remembered in `localStorage`, wrapped in try/catch) or from OS `prefers-reduced-motion`, and stops all non-essential motion.

**Never:**
- No write path: no POST, drag and drop, inline edits, modals, or toasts covering cards. The only interactions are Copy, opening and closing evidence, and the motion toggle.
- No replay bar or `/replay` playback (4-1), no Budget clock drain or CUT behavior (3-1; reserve the header slot and render nothing while `ends_at` is null), no light mode, no Star Wars IP, no web fonts or CDN assets.
- No reading `artifacts/`, and no server-side changes beyond what the tests need.
- No npm dependency outside `src/dashboard/web`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cold load | `/` opened | Top bar and column headers render before data. Lanes appear when `/api/board` returns. No spinners or skeletons | `/api/board` fails → OFFLINE badge, retried via the stream |
| No runs | `projection.runs = []` | `NO RUNS YET` / `Start one in the terminal:` / `/factory [task]` in an Action slot with Copy. Master d2t is seated | — |
| Live | SSE `event: run` | That lane is replaced in place (key `repo_hash/run_id`), or inserted by `started_at` (newest on top) | `event: board` replaces all lanes |
| Offline | Stream errors | Badge `OFFLINE · reconnecting`, board frozen at 90% opacity, not danger-styled | On reopen the browser sends `Last-Event-ID` and the board resyncs with no reload |
| Claim | `claimed` chip, `now ≥ overdue_at` | It flips to UNVERIFIED within ≤ 1 s with no server event | `verified` overrides. `superseded` → dimmed with a `SUPERSEDED` label |
| Needs You | New `needs_you` entry | Gold card with type tag (gate_1/gate_2 → GATE, merge → MERGE, escalation/scaffold_failure/design_choice → ESCALATION, cut → CUT, signal_lost → SIGNAL LOST, else uppercased type), title, REASON when `reason_label`, `raised HH:MM`, and commands with Copy. Polite `aria-live`: `<TYPE>: <title>, run <id>`, coalesced within 1 s | Copy fails → the command text is selected and `Copy failed — command selected` is announced |
| Done deck | > 5 cards in a lane's Done cell | The 4 newest are shown plus a `+N` deck naming the rest. Each seal glyph of a collapsed card is a focusable button | Seals are never unreachable |
| Drawer | A chip, seal or deck glyph is activated | Docked right at 320px, the board narrows. Claim variant: proof table + CLAIMED → VERIFIED chain. Decision variant: event (AD-5 kind), reason, decided by, at, terminal response (`prompt_text`), run/stage, evidence | `×` or `Esc` closes it, and focus returns to the source |
| Signal lost | `lane.live.signal_lost` | The lane's active card shows `SIGNAL LOST · last seen <n>m ago` with a danger static treatment; the SIGNAL LOST card is in Needs You | It clears when a later event drops the flag |

</frozen-after-approval>

## Code Map

- `src/core/projection.ts:12-79` -- the `Lane`/`BoardCard`/`Claim`/`Decision`/`NeedsYou` shapes. Mirror them as browser-side types in `web/src/lib/types.ts` (a copy, not an import). Lanes arrive newest-first, cards in pipeline order (stages, then slices), and seals as decision ids into `lane.decisions`.
- `src/core/events.ts:34` `Card` -- `{type, title, reason_label?, reason?, commands[], escalation?, sha?, target?}`.
- `src/core/cards.ts` -- the card `type` values: `intake, gate_1, gate_2, scaffold_failure, escalation, signal_lost, merge`.
- `src/dashboard/server/http.ts` -- already serves `dashboard/dist` (SPA fallback, traversal guard, `/replay/<name>` → index). The SSE stream sends `retry: 2000`, `event: run|board`, ids = cursor, and `: ping` every 15 s. No change is expected.
- `src/dashboard/server/main.ts:44-57` -- SIGNAL LOST is added at serve time as `lane.live.signal_lost` plus a `needs_you` entry `{ask_id:'signal_lost'}`.
- `src/store/paths.ts:40` `dashboardDistDir()` = `<plugin>/dashboard/dist` -- the Vite `outDir`.
- `tsconfig.json` -- excludes `src/dashboard/web`. The web package has its own `tsconfig.json`.
- `test/layers.test.ts` -- skips `dashboard/web`. Add the web isolation check here.
- `test/dashboard.test.ts` -- the existing `%2e%2e` traversal assertion is vacuous (deferred from 2-1). Replace it with a real guard test now that dist exists.
- `test/harness.ts:119` `serveBoard` and `test/pipeline.test.ts` (1-5 acceptance) -- a real server on a free port, reusable for the served-SPA test.
- DESIGN.md: tokens D:15–208, component specs D:564–631, roster D:651–665, sprite rules D:641–649, deviations D:667–685. EXPERIENCE.md: lifecycles E:80–97, Needs You E:101–155, drawer E:200–209, states E:257–259, motion E:295–319, a11y E:325–331. Mocks: `mockups/key-dashboard.html`, `mockups/key-wrap.html`.
- Playwright Chromium is cached at `~/Library/Caches/ms-playwright/chromium_headless_shell-1248`, for screenshot verification only.

## Tasks & Acceptance

**Execution:**
- [x] `src/dashboard/web/{package.json,package-lock.json,tsconfig.json,vite.config.ts,index.html}` -- a private ESM package with exact-pinned dev deps. Vite `outDir: '../../../dashboard/dist'`, `emptyOutDir: true`, `base: '/'`, and no external URLs. Scripts: `build`, `dev`.
- [x] `src/dashboard/web/src/lib/model.ts` -- pure, DOM-free view logic: `cells(lane)` groups cards by column, `counts(lanes)` gives board-wide column counts, `doneDeck(cards)` returns the 4 newest + rest when > 5 (newest = last in pipeline order), `chipState(claim, now)`, `sealsOf(card, lane)`, `typeTag(card)`, `verdictText(v)` (APPROVE/ESCALATE as is, else the first line cut to 14 characters), `ago(ts, now)`, `emptyCellCopy(lane, column)` (`AWAITING GATE 1`/`AWAITING GATE 2` in backlog before slices exist, else none), `upsertLane(lanes, lane)`.
- [x] `src/dashboard/web/src/lib/{stream.ts,motion.ts,announce.ts,sprites.ts,tokens.css}` -- the board store (fetch, then EventSource, plus mode `live|offline`), the reduce-motion store, the coalescing polite announcer, 16×16 two-frame pixel maps for the roster (Master d2t, Adm. Vess Korrin as conductor, Brix, Sela Venn, Tarvus, Kael Nox, Mira Sol, Pell, Quill) drawn as inline SVG, and the DESIGN.md tokens.
- [x] `src/dashboard/web/src/{main.ts,App.svelte,components/*.svelte}` -- TopBar (brand, Mode badge, Truth legend, toggle), ColumnHeaders (sticky; Master d2t seat in Needs You), Lane (header with conductor sprite, run-id chip, task, origin tag, stage gold when parked, an empty Budget slot, Stage track with gate diamonds), StageCard (holo-plate), SliceCard (datapad, `round n/2`, verdict rows), ClaimChip, Seal, NeedsCard + ActionSlot/Copy, DoneStack, Drawer, EmptyCell, Sprite. A 1 s clock tick drives chip and `ago` rendering. Unknown roles map to the conductor sprite.
- [x] `dashboard/dist/` -- built output, committed.
- [x] `test/web-model.test.ts` -- node:test on `model.ts`: the matrix's Claim, Done deck, type-tag and empty-cell rows, counts, and upsert ordering. Use lanes produced by `projectRun(fold(...))` on `test/fixtures/*.jsonl` (`readLines` + `fold`, as `test/projection.test.ts:10-18` does) so UI logic is tested against real projections.
- [x] `test/layers.test.ts` -- add: every relative import in `src/dashboard/web/src/**` resolves inside `src/dashboard/web`, and bare imports are only `svelte` and `svelte/*`.
- [x] `test/dashboard.test.ts` -- with dist present: `/` and `/replay/x` serve the built `index.html` (contains `id="app"`), a built asset is served with a JS content type, and `/../package.json` plus `/assets/..%2f..%2fpackage.json` get 404. Replace the vacuous `%2e%2e` assertion.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- add an entry: the AD-16 fallback build into the plugin data dir when `dashboard/dist` is missing (not built here; dist is committed).

**Acceptance Criteria:**
- Given a home with the 1-5 completed run, when `/` is opened in headless Chromium (Playwright from the cache), then one lane shows every card in Done, every chip reads VERIFIED, and the intake, gate 1, gate 2 and merge seals are each focusable and open the Decision drawer. Screenshots are taken at 1440×900 (live and drawer-open) and inspected against the mocks.
- Given a run parked at gate 1, when the page is open and the gate is approved via the CLI, then without a reload the GATE card leaves Needs You and SPEC moves to Done with its seal.
- Given the repo, when Verification runs, then all tests pass, tsc reports 0 errors, `npm run build` in `src/dashboard/web` reproduces `dashboard/dist`, and no test leaves a process listening.

## Implementation Notes

- **Additions beyond the task list.** `lib/types.ts`, `lib/drawer.ts` (selection plus focus return by `data-src`), `lib/glide.ts` (crossfade between cells, streak into Done), and the `Glyph`, `Agent` and `ClaimList` components. `model.ts` also holds `stageTrack`, `stageWord`, `needsCell`, `sealLine`, `truthCounts` and the roster names.
- **Choices.**
  - Master d2t's seat sprite is 32×30, as in DESIGN's placeholder; the rest of the roster is 16×16.
  - The Truth legend shows a claim count per state.
  - Claims render one row each (name + mini chip).
  - A slice IN_REVIEW with no reviewer claim newer than its builder report shows a `reviewers · reviewing…` row, because the projection does not list a roster.
  - `emptyCellCopy` also returns nothing for terminal runs.
  - Decision evidence ids that match no claim render as raw ids.
  - The `$ ` before commands is a CSS pseudo-element, so neither copying nor the selection-on-failure includes it.
- **Not type-checked.** `.svelte` files (svelte-check is not an allowed dependency). The `.ts` files pass the root tsc through `test/web-model.test.ts`.
- **Verification (2026-10-24).**
  - `node --test test/`: 213 pass, 0 skipped. It ran outside the sandbox, which blocks port binding.
  - tsc exits 0.
  - Fixture shasums are unchanged.
  - Rebuilding `dashboard/dist` is byte-identical.
  - No listener is left on a test port.
- **Browser checks.** A scratch Playwright matrix script (headless Chromium 1248, not committed) asserted cold load, Needs You card, Copy failure and Copy success, signal lost, both drawer variants (board narrows by 320px, Esc and × return focus), the claim flip to UNVERIFIED at `overdue_at`, no runs, then a live insert with the `aria-live` announcement, the Done deck `+3` with a reachable intake seal, and reduced motion (0 running animations). A real run parked at gate 1 and approved through `factory decide` updated in 439 ms with no reload; offline showed `OFFLINE · reconnecting` at 0.9 opacity and recovered to LIVE.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-24): blind-hunter (B), edge-case-hunter (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| B1 | The Done deck treats the last card in pipeline order as newest, but WRAP comes before the slices in `lane.cards` | medium | The projection pushes every stage card, then the slices (`projection.ts:264,269`). WRAP completes after BUILD, so its merge seal drops into `+N` once there are ≥4 slices. This Design Notes proxy was wrong | patch: true pipeline order (stages ≤ SLICE PLAN, slices, WRAP) |
| E7/B2 | The clock keeps ticking offline, so chips flip to UNVERIFIED and `ago` advances on a board that should be frozen | medium | `stream.ts` `now` is a free-running 1 s interval, and `chipState` compares it with `overdue_at`. The matrix's Offline row says the board is frozen | patch: hold the last live `now` while offline |
| E1 | The seal-row each key `s.d.id` is duplicated when one decision seals two collapsed cards | medium | 2-1 seal rules: gate 1 → SPEC and DESIGN, and a cut → several slices. A duplicate key in a keyed each is a Svelte error | patch: key by card and decision |
| E10/B3 | The second loop in `evidenceOf` is unreachable | low | The first loop already returns for every claim whose evidence contains the id. Deleting it is a direct fix | patch: delete dead code |
| B14 | `ago` comment says "largest whole unit" but returns `47h ago` | low | `h < 48` in `model.ts`. Direct fix | patch: days from 24 h |
| E13 | Test `upTo` slices to -1 when the predicate matches nothing | low | `findIndex` → -1, so `slice(0,-1)` would use almost the whole run. A direct assertion fixes it | patch |
| E14/B4 | `'/../package.json'` and `'/%2e%2e/…'` probes never reach `isUnder` | low | The client and `URL` normalize both into dist. The real `%2f` probes do cover the guard. Deleting the two is a direct fix | patch: delete the two probes |
| V1 | `needsCell` host branch (stage cards under a gate card) is untested | medium | Pre-verified: the only `needsCell` test has a slice ask, so `host` is undefined | patch: gate-parked lane test |
| V2 | `stageTrack`/`stageWord` waiting path is untested | medium | Pre-verified: no fixture lane has a waiting gate | patch: same lane |
| V3 | `activeCardId` (SIGNAL LOST placement) is untested | medium | Pre-verified: no test references it | patch |
| V4/B8 | The `stream.ts` client (cursor handoff, run/board frames, offline, reopen) is untested | medium | Pre-verified: no test imports `stream.ts`. The browser matrix run was scratch | patch: stubbed fetch/EventSource test, skipped when the web deps are not installed |
| V5 | `announce.ts` 1 s coalescing is untested | low | Pre-verified (filed as defer). `node:test` `mock.timers` makes it cheap alongside V4 | patch |
| V6/B6 | Nothing checks that the committed `dashboard/dist` matches the sources | medium | Pre-verified: `dashboard.test.ts` reads dist from disk, so a stale build passes | patch: build to a temp dir and compare |
| V7/B5 | The placeholder (no-dist) branch lost its only test | medium | Pre-verified: dist is committed, so no test reaches `!existsSync(index)`. Testing it needs a dist-dir override that the deferred AD-16 fallback will add | defer |
| E2/B11 | Cards grouped in a NeedsCard never get the SIGNAL LOST variant or the glide | low | SIGNAL LOST needs a working (non-parked) run whose only active card is in Needs You, and the needs-column SIGNAL LOST card still shows. The fix threads new props | reject |
| E3 | An unknown column is shown in Backlog but not counted | false | `Column` is a closed union produced only by `projection.ts` | reject |
| E4 | SPEC∥DESIGN reads done while DESIGN is still active | low | No DESIGN stage exists until 3-2. The fix adds merge logic | reject (revisit in 3-2) |
| E5 | Two non-slice asks: all waiting stage cards attach to the first | low | Needs a gate and a stage-level escalation open at once, which no current flow produces. The fix adds matching logic | reject |
| E6 | A malformed SSE frame breaks rendering | false | Frames come only from `http.ts` `sse()` over a `Lane`/`Board` | reject |
| E8 | An urgent `say()` within 30 ms of a coalesced flush races | low | Needs a Copy click within 30 ms of a flush; the fix adds timer state | reject |
| E9 | Focus falls to body when the drawer's source is gone | low | Happens only when a lane is removed while the drawer is open; the fix adds a fallback branch | reject |
| E11 | `reported_at` is compared as a string | false | Every ts is written by the CLI in one `toISOString` format (`TS_RE`) | reject |
| E12 | `round 3/2` is possible | false | Retrigger rounds are capped at 2 by the state machine (EXPERIENCE: max 2) | reject |
| E15 | The spec says 16×16 for Master d2t, but it is 32×30 | low | Follows DESIGN's placeholder seat, as recorded in Implementation Notes. The fix would edit the spec | reject |
| E16/B12 | No distinct cold-load or never-connected state | false | The matrix's Cold load row is chrome-only with no spinners or skeletons. An unreachable server shows `OFFLINE · reconnecting` | reject |
| B7 | `.svelte` files are not type-checked | low | `svelte-check` would be a fourth npm dep, which the frozen Boundaries forbid | reject |
| B9 | `verdictText` cuts `VERDICT: FINDINGS` to fragments | false | `Claim.verdict` is the parsed word (`reducer.ts:213`, fixtures `"verdict":"APPROVE"`), not the first line | reject |
| B10 | Copy buttons share one accessible name; an empty command list shows a bare header | false | EXPERIENCE names it `Copy command`, and every card from `cards.ts` has at least one command | reject |
| B13 | Reconnects retry forever every 2 s | false | A persistent local server that comes back is the design. The badge says reconnecting | reject |
| B15 | No ignore rule for `src/dashboard/web/node_modules` | low | There is no VCS in this checkout, so the fix has no effect here | reject |
| B16 | Every component re-renders each second | low | POC scale (a handful of lanes); the fix adds deadline scheduling | reject |

## Design Notes

**Data flow.** `stream.ts` does `fetch('/api/board')` → `{cursor, projection}`, then `new EventSource('/api/stream?since=' + cursor)`. On `run`, it calls `upsertLane`. On `board`, it replaces. `onerror` → `offline`, and `onopen` → `live`. The browser's own reconnect sends `Last-Event-ID`, which the server honors. If the stream closes for good (`readyState === CLOSED`), it is recreated after 2 s from the last seen id.

**Superseded.** Superseded claims and decisions (AD-33 voids) render dimmed with a `SUPERSEDED` text label and are excluded from the Truth counts, but their seals stay reachable.

**Done order.** The projection has no completion time per card. Pipeline order (stages, then slices by id) is a faithful proxy, so the "newest" Done card is the last one.

## Verification

**Commands:**
- `npm ci --prefix src/dashboard/web --cache "$TMPDIR/npm-cache" && npm run --prefix src/dashboard/web build` -- expected: exit 0, and `dashboard/dist/index.html` exists.
- `node --test test/` -- expected: all pass.
- `npm i --prefix "$TMPDIR/tsc" --cache "$TMPDIR/npm-cache" typescript@7.0.2 @types/node@22 && "$TMPDIR/tsc/node_modules/.bin/tsc" -p tsconfig.json --typeRoots "$TMPDIR/tsc/node_modules/@types"` -- expected: exit 0.
- `shasum test/fixtures/*.state.json` before and after -- expected: identical.

**Manual checks:**
- Run Playwright screenshots (from `$TMPDIR`, not committed) of a served fixture home at 1440×900: live, drawer open, offline (server killed), no runs, and reduced motion. Compare them against `mockups/key-dashboard.html`.
