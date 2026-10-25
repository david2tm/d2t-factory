---
title: 'Dashboard server and projection'
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Runs are visible only through CLI JSON. There is no read model for the board: no claimed-vs-verified overlay, no decision seals, no live stream. `start` and `resume` return `dashboard_url: null`, and story 2-2 has no API to build the UI on.

**Approach:** Add a pure `core/projection.ts` that turns a loaded run into a board lane: stage and slice cards with columns, claim chips with deadlines, Needs You cards and Decision seals. Add a read-only singleton server, `src/dashboard/server`, that tails `~/.factory` into a rebuildable `cache.sqlite` and serves `GET /api/board` plus SSE `/api/stream`. `start`, `resume` and a new `factory dashboard` verb start it detached and return its URL.

## Boundaries & Constraints

**Always:**
- Node built-ins only (`node:sqlite`, `node:http`, `fs.watch`), and AD-2 layering: the server imports only `core` and `store`, and the CLI never imports the server. It spawns it by path from `paths.ts`.
- Every projection is computed by `loadRun` plus `project()`, and is a pure function of commands and facts. `now` never enters the cached projection. Only SIGNAL LOST is a live overlay, held in memory.
- Thresholds come only from `core/config.ts`. All paths come from `paths.ts`. Bind to `127.0.0.1` only.
- The `Host` must be `127.0.0.1:<port>` or `localhost:<port>`, or the request gets a 403. Non-GET requests get a 405.
- A dashboard failure never fails `start` or `resume`: they return `dashboard_url: null` plus `dashboard_error`.
- Existing fixture snapshots stay byte-identical.

**Never:**
- No write path: no POST, and no route that appends commands.
- No reading of `artifacts/`.
- No Svelte UI, Vite build or `dashboard/dist` (2-2).
- No replay playback (4-1): `/api/recordings/<name>` only returns 404 `RECORDING_NOT_FOUND`, or 501 when the recording exists.
- No budget, cut or time-box deadlines beyond `null` placeholders (3-1).
- No new npm dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Board | 2 runs under 2 repo hashes | `GET /api/board` → `{cursor, projection:{runs:[…]}}`, newest `run_started` first | A bad JSONL line is skipped and counted in the lane's `skipped` |
| Live | A command is appended to a watched run | Within ≤ 2.5 s (watch, or the 2 s poll), SSE sends `event: run`, `id: <cursor>`, with that lane | A partial trailing line waits for its `
` |
| Reconnect | `Last-Event-ID` or `since` = N ≤ cursor | Sends `run` events for lanes changed after N | N unknown or > cursor → one `event: board` snapshot |
| Rebuild | Server stopped, `cache.sqlite` deleted, restarted | `/api/board.projection` deep-equals the earlier one | Cache schema or version mismatch → drop and rebuild |
| Claim | A `reported` step | Chip `claimed` with `overdue_at` = `step_reported.ts` + `CLAIM_OVERDUE_MS` | `step_verified` → `verified`, with its evidence rows. A voided step → `superseded: true` |
| Signal lost | Working (non-terminal, not parked) run, no event since `signal_lost_at`, and its holder is not in `claude agents --json` | Lane `live.signal_lost: true` and a `signal_lost` Needs You card with `/factory resume <run-id>` | Liveness lookup fails → counts as live (`sessionLive`) |
| Singleton | `factory dashboard`, with a live server of the same version and root | Returns the same URL; no second process | Version or root mismatch → SIGTERM the old pid, then respawn |
| Foreign port | Port held by a non-factory process | `dashboard_url: null`, `dashboard_error: "port <n> is in use by another process"` | The pid file is never written |
| Host | `Host: evil.test:4870` | 403 | — |

</frozen-after-approval>

## Code Map

- `src/store/load-run.ts` `loadRun` -- the only reader. Its `skipped` feeds the lane's `skipped` count.
- `src/store/jsonl.ts` `readLines(file, offset)` -- for incremental tailing. It returns the next `offset`, and `dedupeById` de-duplicates.
- `src/core/reducer.ts` -- `apply`, `fold`, `boardStage`, `openSteps`, `isTerminal`, and `RunState` (`asks`, `voided`, `slices`, `steps`, `checks`). "Parked" means every open step is `ask_human` (AD-12; see `core/stop.ts`).
- `src/core/verify.ts` -- add `claimOverlay(state, step, reportedTs)` → `{state:'claimed'|'verified'|null, overdue_at, evidence}`. This is the AD-7 single home. Reuse `isVoided`.
- `src/core/events.ts` -- `DECISION_KINDS`, `Card`, and `DecisionBase.prompt_text`, which is already redacted at embed time.
- `src/core/cards.ts` -- add `signalLostCard(runId)` (type `signal_lost`, commands `['/factory resume <run-id>']`). Every other card comes from `ask_raised.data.card` and `state.asks`.
- `src/core/config.ts` -- the `CLAIM_OVERDUE_MS`, `HEARTBEAT_INTERVAL_MS`, `SIGNAL_LOST_MISSED` and `DASHBOARD_PORT_DEFAULT` constants already exist. Add `DASHBOARD_POLL_MS = 2000`.
- `src/store/paths.ts` -- add `dashboardPidFile()`, `dashboardLog()`, `cacheDb()` (all under `factoryHome()`), `dashboardServerEntry()` (the plugin's `src/dashboard/server/main.ts`) and `dashboardDistDir()` (the plugin's `dashboard/dist`).
- `src/store/sessions.ts` -- `PluginEnv`/`writePluginEnv` and `sessionLive`. Add `readPluginEnv()`.
- `src/cli/record.ts:77` `pluginVersion()` -- move it to the store (for example `store/plugin.ts`) so the CLI and the server share it.
- `src/cli/start.ts:64` and `src/cli/resume.ts:56` -- replace `dashboard_url: null` with `...await ensureDashboard()`.
- `src/cli/main.ts` -- register the `dashboard` verb (it requires `--session`, like every verb).
- `test/harness.ts:36` and `test/driver.test.ts:21` -- set `FACTORY_DASHBOARD_OFF=1` in `w.env`, so the existing tests never spawn a server and `driver.test.ts:101,357` keep their `dashboard_url: null`.
- `test/layers.test.ts` -- already scans `dashboard/server`. It must stay green.
- `test/fixtures/*.jsonl` -- realistic runs for the projection tests. Do not regenerate them.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/projection.ts` -- `projectRun(loaded, opts)` → `Lane` and `projectBoard(lanes)`, with the shape in Design Notes. Fold the commands stepwise with `apply` so each decision knows its stage. Pure.
- [x] `src/core/{verify,cards,config}.ts` -- `claimOverlay`, `signalLostCard` and `DASHBOARD_POLL_MS`.
- [x] `src/store/{paths,sessions,plugin}.ts` -- the new paths, `readPluginEnv`, and `pluginVersion` (record.ts imports it).
- [x] `src/dashboard/server/cache.ts` -- `node:sqlite` with these tables:
  - `meta(schema, plugin_version)`;
  - `files(path PK, offset, ino)`;
  - `events(cursor INTEGER PK AUTOINCREMENT, id UNIQUE, repo_hash, run_id, kind, ts, json)`;
  - `runs(repo_hash, run_id, cursor, projection, PK(repo_hash, run_id))`.

  Use `INSERT OR IGNORE` by `id`. Don't use `createTagStore`.
- [x] `src/dashboard/server/tail.ts` -- a recursive `fs.watch(factoryHome())` (debounced) plus a `DASHBOARD_POLL_MS` scan of `*/runs/*/{commands.jsonl,facts/*.jsonl}`. Use `readLines` from the stored offset, and reset to 0 when the size drops below the offset or the inode changes. For each touched run, upsert `loadRun` + `projectRun` and notify subscribers.
- [x] `src/dashboard/server/http.ts` -- the routes in the matrix, plus:
  - `GET /api/health` → `{pid, plugin_version, root}`;
  - static files from `dashboardDistDir()` (no path traversal), else a plain placeholder page at `/` and `/replay/<name>`;
  - SSE with `: ping` every 15 s.
- [x] `src/dashboard/server/main.ts` -- listen on `127.0.0.1:<readPluginEnv().dashboard_port ?? default>`. On `EADDRINUSE`, exit 3. After the bind, write `dashboard.pid` `{pid, plugin_version, root}` with an atomic rename. Every `HEARTBEAT_INTERVAL_MS`, re-evaluate SIGNAL LOST for working lanes past `signal_lost_at`. On SIGTERM, close and remove the pid file if it is ours.
- [x] `src/cli/dashboard.ts` -- `ensureDashboard()` (see Design Notes) and the `dashboard` verb.
- [x] `src/cli/{start,resume,main}.ts`, `test/{harness,driver.test}.ts` -- wire up and opt out, per the Code Map.
- [x] `skills/factory/SKILL.md` -- after `start` or `resume`, print `Dashboard: <dashboard_url>` once when it is non-null.
- [x] `test/projection.test.ts` -- fixtures → lanes: columns, chips, seals, voided-as-superseded and the matrix's Claim row.
- [x] `test/dashboard.test.ts` -- a real server on a free port in a temp `FACTORY_HOME`. Cover the Board, Live, Reconnect, Rebuild, Host, Singleton and Foreign port rows, and Signal lost via `FACTORY_CLAUDE_AGENTS_JSON`. Kill the servers in `after`.

**Acceptance Criteria:**
- Given a pipeline run driven to COMPLETED (the 1-5 harness), when its home is served, then every stage and slice card is in `done`, every claim chip is `verified`, and each human decision appears once as a seal. Those seals are intake, gate 1, gate 2 and merge.
- Given the repo, when Verification runs, then all tests pass, tsc reports 0 errors, the fixture shasums are unchanged, and no test leaves a process listening.

## Implementation Notes

- **Needs You also lists open gate and merge cards.** `gate_1`, `gate_2` and `merge` cards are `ask_human` steps (`step_issued.data.card`), never `ask_raised`, so `state.asks` alone would leave every gate out of Needs You and keep SPEC, SLICE_PLAN and WRAP out of the `needs_you` column. `needs_you` = open `state.asks` (escalations; `ask_id` = the `ask_raised` id) plus open `ask_human` steps whose card has no `escalation` (those repeat an ask) and is not `intake` (EXPERIENCE: intake has no Needs You card; `ask_id` = the step id). The card is always the one recorded in the command.
- **`claimOverlay(state, step, reportedTs, verifiedEvidence = [])`.** `RunState` does not keep `step_verified.data.evidence`, and adding it to the reducer would change the fixture snapshots. The projection passes the ids from its stepwise fold, and resolves them to rows against the commands and facts (`ref` for ids that are not events, such as `cwd:` proofs).
- **Superseded claims** are voided steps (AD-33) and reissued steps. A reissued step's claim is never verified, and a newer step replaced it.
- **Seals.** intake → INTAKE; gate 1 → SPEC (+DESIGN when that card exists); gate 2 → SLICE_PLAN; merge → WRAP; rework → the gate's stage card or the slice; escalation ruling → its slice, else its step's stage card; cut → the cut slices (a keep → the kept Backlog slices); rerun → that stage; abandon → the current stage card or active slice. `decided_by` is the command's actor (`human`). `reason` is set for escalation rulings only (`reason_label: reason`, or the title).
- **Cursor.** Each scan inserts its lines into `events` (`INSERT OR IGNORE` by id). Changed lanes share the new max cursor. A change that no new line explains (a reset file, a repeated skipped line, or a SIGNAL LOST flip from the heartbeat) gets a `~`-prefixed marker row, so cursors only grow and a reconnect also sees live flips. A removed run sends an `event: board` snapshot.
- **`dashboard.pid` also records `port`** (`{pid, plugin_version, root, port}`). `ensureDashboard` signals a pid only after `/api/health` on that port answers with the same pid, so a reused pid is never killed. A version, root or port mismatch stops the confirmed server (SIGTERM, then SIGKILL after 2 s). An unconfirmed pid file counts as stale, and the CLI spawns a new server beside it.
- **Liveness.** The server makes one `claude agents --json` lookup (`liveSessions()`) per evaluation pass (startup, scan, heartbeat), and only when some lane is past `signal_lost_at`.
- **`test/hooks.test.ts` also sets `FACTORY_DASHBOARD_OFF=1`.** It runs `start` and `resume` too, and would otherwise spawn servers on the default port.
- **Acceptance** is asserted at the end of `pipeline.test.ts`'s 1-5 acceptance test through `harness.serveBoard` (a real server on a free port). The tests that bind a port skip where binding is not permitted, as `pipeline.test.ts` already does.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-24): blind-hunter (B), edge-case-hunter (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| B1/E1/E2/V6 | `ensure()` SIGTERMs a pid it hasn't confirmed: a stale pid reused by another process, or a healthy server slow to answer health | medium | `dashboard.ts` calls `stop(p.pid)` when the pid is alive but version, root or health don't match. The pid file survives a SIGKILL, a crash or a reboot | patch: signal only a pid that `/api/health` on the port confirms; otherwise treat the pid file as stale |
| B2/E5/V7 | `stop()` never escalates, so an old server still alive after 2 s is reported as a foreign process | low | `stop` polls 2 s with no SIGKILL. `shutdown` exits within ~1 s unless the event loop is blocked (see B4) | patch: SIGKILL after `STOP_WAIT_MS` |
| B4/B9/E3 | SIGNAL LOST runs `claude agents --json` (spawnSync, 5 s timeout) once per lane, blocking HTTP and startup | medium | `main.ts` `lost()` → `sessionLive` per lane, at startup and on every beat. Every stale non-terminal run costs one blocking spawn, which can push startup past `START_WAIT_MS` | patch: one lookup per evaluation pass, shared by all lanes (a store helper that returns the live set, or null when the lookup fails) |
| E6 | An event ts that passes `TS_RE` but is out of range (month 13) throws in `toISOString`, rolling back every scan and freezing the board | low | `TS_RE` (`events.ts:177`) is purely lexical. `projectRun` computes `new Date(Date.parse(last)+…).toISOString()`, and the error aborts the scan transaction for all runs | patch: `Number.isFinite` guard |
| B5 | The detached server inherits the CLI's cwd (possibly a worktree) | low | `spawn` sets no `cwd`; the fix is a direct correction | patch: `cwd: factoryHome()` |
| B13 | SKILL.md hides `dashboard_error` from the human | low | "Say nothing about a `dashboard_error`", so a port held by another process stays silent; the fix is a direct text change | patch: print `Dashboard unavailable: <dashboard_error>` once |
| E19 | `serveBoard` leaks the server if an assertion fails before cleanup | low | It asserts the URL before it reads the pid. The AC says no test leaves a process listening | patch: read the pid and clean up in `finally` before asserting |
| V1 | `start`/`resume` returning the real URL or `dashboard_error` is untested | medium | every start/resume test sets `FACTORY_DASHBOARD_OFF` | patch: test `start`/`resume` with the dashboard on, and with the port held |
| V2 | A SIGNAL LOST flip while the server runs is untested | medium | only the startup evaluation is asserted | patch: append to the lost run and assert the stream clears it |
| V4 | `sealTargets` rules for rerun/orient, cut keep, design, abandon in BUILD and stage-level rulings are untested | medium | the fixtures cover only cut S2, abandon in RECON and a slice ruling | patch: projection tests |
| V5 | Tail reset, run removal and a port change are untested | medium | no test truncates or replaces a file, removes a run dir, or changes `dashboard_port` | patch: tests in `dashboard.test.ts` |
| V3 | The traversal assertion never reaches the `isUnder` guard (no `dashboard/dist`; `URL` normalizes `%2e%2e`) | medium | `http.ts` returns 404 from the placeholder branch first | defer: dist arrives in 2-2 |
| B3/E4 | Concurrent spawns, or a healthy server whose pid file is gone, are reported as a foreign port | low | Needs two sessions starting within ~3 s, or the pid file deleted by hand. The fix adds a probe branch | reject |
| B6/E8/E9/V8 | A reconnect after a run removal or a cache rebuild can miss removals | low | Run dirs are never pruned automatically (only `start`'s millisecond rollback), and after a rebuild every lane gets a new cursor above the old ids. The fix adds epoch state | reject |
| B7 | `events` stores every line's JSON and `dashboard.log` never rotates | low | The spec prescribes the events table. POC-scale homes | reject |
| B8/E14 | `Cache` deletes the db on any open error, including SQLITE_BUSY | low | Only the bound server opens the cache, and the port bind excludes a second server | reject |
| B10/E10 | A transient `readdirSync` failure empties the board until the next poll | low | Needs EMFILE or EACCES on `~/.factory`; the next 2 s poll restores it | reject |
| B11 | `last_event_at` counts commands the reducer rejected | false | AD-21: a heartbeat is any command or fact for the run, and the CLI gates commands before appending | reject |
| B12 | Various untested paths (stop timeout, pid reuse, tests sharing a seeded home) | low | Covered where it matters by V1/V2/V4/V5; the remainder are the rejected rows above | reject |
| B14 | The server never shuts itself down | false | AD-16 makes it a persistent singleton that restarts on a version mismatch; the Deferred list has no lifecycle verb | reject |
| E7 | SSE can carry lanes with no `run_started` that `/api/board` excludes | low | `start` writes `run_started` in the same locked append that creates `commands.jsonl` | reject |
| E11 | A deleted facts file never reprojects its lane | low | Facts files are append-only and only go away with the whole run dir | reject |
| E12 | An exception in `beat`, `onScan` or `handle` kills the server | low | No reachable throw was shown; the next CLI call respawns the server | reject |
| E13 | A stalled SSE consumer buffers without bound | low | The consumer is a local browser tab | reject |
| E15 | Rerunning DESIGN with no DESIGN card drops the seal | low | `rerun` isn't implemented until 3-x | reject |
| E16 | A rerun before BUILD that wipes slices drops their claims | low | `rerun` isn't implemented until 3-x | reject |
| E17 | An ABANDONED run's current stage shows as active, in_progress | low | The card's `state: 'abandoned'` and `lane.terminal` carry it; the column placement is a UI choice for 2-2 | reject |
| E18 | The CLI and the child read `plugin-env.json` separately | low | Needs a SessionStart port change within the ~3 s spawn window | reject |

## Design Notes

**Lane shape.** `projection.runs[]` is `Lane`:

```ts
{ run_id, repo_hash, task, origin:'brownfield'|'greenfield', phase, stage, holder, started_at, last_event_at,
  terminal, parked, skipped, deadlines:{signal_lost_at, overdue_at, cut_at:null, ends_at:null, timebox_ends_at:null},
  stage_track:[{stage, status:'pending'|'active'|'waiting'|'done'}], gates:[{n:1|2, status:'hollow'|'waiting'|'passed'}],
  cards:[{id, kind:'stage'|'slice', label, column:'backlog'|'in_progress'|'in_review'|'needs_you'|'done',
          state, rounds?, claims:Claim[], seals:string[], superseded}],
  needs_you:[{ask_id, raised_at, slice?, card}],             // from state.asks, open, oldest first
  decisions:[{id, kind, at, decided_by, prompt_text, reason?, stage, evidence:string[], superseded}],
  live?:{signal_lost:boolean} }                              // added at serve time, never cached
Claim = {step_id, role, kind, state:'claimed'|'verified', reported_at, overdue_at, verdict?, superseded,
         evidence:[{id, kind, ts, path?, check?, exit_code?}]}  // ids, kinds and paths only, never fact text
```

**Columns.** Slices map BACKLOG→backlog, BUILDING→in_progress, IN_REVIEW/FINDINGS_QUEUED→in_review, ESCALATED→needs_you and CLOSED/CUT→done. Stage cards follow EXPERIENCE.md's Stage lifecycle: `in_progress` while active, `needs_you` while that stage's ask is open, `done` once completed. BUILD has no stage card. Its slices are the cards.

**`ensureDashboard()`.** `FACTORY_DASHBOARD_OFF` → `{dashboard_url:null}`. Otherwise:
1. If the pid file is alive, matches the plugin version and root, and `/api/health` answers within 1 s, return the URL.
2. If it is alive but mismatched, SIGTERM it and wait ≤ 2 s.
3. Spawn `process.execPath --disable-warning=ExperimentalWarning <entry>`, detached and unref'd, with its output to `dashboard.log`. Poll health for ≤ 3 s until the pid matches the child.
4. If the child exits 3, report the port as foreign.

## Verification

**Commands:**
- `node --test test/` -- expected: all pass.
- `npm i --prefix "$TMPDIR/tsc" --cache "$TMPDIR/npm-cache" typescript@7.0.2 @types/node@22 && "$TMPDIR/tsc/node_modules/.bin/tsc" -p tsconfig.json --typeRoots "$TMPDIR/tsc/node_modules/@types"` -- expected: exit 0.
- `shasum test/fixtures/*.state.json` before/after -- expected: identical.

**Manual checks (if no CLI):**
- `bin/factory dashboard --session x`, then `curl -s -H 'Host: 127.0.0.1:4870' 127.0.0.1:4870/api/board` lists the real runs under `~/.factory`.
