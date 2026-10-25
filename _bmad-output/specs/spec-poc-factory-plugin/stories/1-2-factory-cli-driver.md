---
title: 'Factory CLI driver'
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

**Problem:** The CLI has only `setup`. Nothing drives a run yet: nothing starts or resumes one, issues or claims steps, binds a session, or turns a human-typed `/factory` prompt into a decision. Until that exists, sequencing and legality depend on the LLM.

**Approach:** Add the verbs `start`, `resume`, `status`, `next [--wait]`, `claim`, `done` and `decide`. Add session binding (AD-25), inbox consumption with the transcript cross-check (AD-6/26), and run resolution (worktree, then the single live run, then a list). The only stage table `next` gets now is INTAKE: one `ask_human` intake card. 1-4 adds the other stages' steps and AD-7 agent-step verification. Tests write inbox and transcript lines directly, because the hooks arrive in 1-3.

## Boundaries & Constraints

**Always:** Node built-ins only. AD-2 layering holds (`test/layers.test.ts` stays green). Every verb except `setup` requires `--session`. If `CLAUDE_CODE_SESSION_ID` is set and differs, the verb fails with `BAD_ARGS`. Fold → validate → append happens under `withLock`, and `apply` gates each append. Git runs only in `src/cli`. New paths go only through `paths.ts`, each with an env override for tests. Changes to `events.ts` are additive. Fixture snapshots stay byte-identical.

**Never:** No hooks, skills or agents. No worktree creation, checks, RECON+ step tables or AD-7 agent-step verification (all 1-4). No orphan or overdue reissue. No greenfield `git init` (5-2). No lock hardening: the 1-1 deferred entry stays open, because 1-2 adds no new contention pattern. No decision arguments on `decide`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Start | Newest unconsumed prompt is `/factory add login`, transcript matches | Consumes it. Appends `run_started` (embeds the prompt facts), then `session_bound`. Writes `sessions/<s>.json`. Returns `{run_id, dashboard_url: null}` | Not a git repo → `BAD_ARGS`. `~/.factory` or `node` link missing → `SETUP_REQUIRED`. `plugin-env.json` missing → `SETUP_REQUIRED` "restart the session" |
| Bare start | Prompt is bare `/factory`, `start <task>` | The positional task is used | A positional task with a task prompt that differs → `BAD_ARGS` |
| Loop | INTAKE, `next` | Issues one `ask_human` step with the intake card. A second `next` reissues nothing and returns it in `steps` | `claim` on a non-issued step → `CLAIM_TAKEN` |
| Decide legal | `/factory approve intake`, transcript matches | Consumes it. Appends `intake_confirmed` plus `step_verified` for the open intake step, under one lock | Append fails → `rmdir consumed/<prompt_id>` |
| Decide illegal | `/factory approve gate1` in INTAKE | Consumed, `ILLEGAL_TRANSITION` | — |
| Non-decision | Task text, `resume [id]`, bare | Not consumed. Returns `{intent, resolution}` | — |
| Forged | No turn with that `promptId`+`sessionId`+`turnOrigin:"human"`+text, or the transcript is not exactly one realpath under projects | Consumed, `NO_HUMAN_PROMPT` "UNVERIFIED · transcript mismatch" | `transcript_path` in a fact is never read |
| Supersede | Two unconsumed prompts | The newest is used. Older ones are marked consumed as `superseded` | No prompt → `NO_HUMAN_PROMPT` |
| Non-holder | `next`/`claim`/`done` from a session that isn't `state.holder` | `NOT_HOLDER` | `start`, `resume`, `decide` are exempt |
| Bare resume | Holder is live in `claude agents --json` and isn't the caller | `CLAIM_TAKEN` | `resume <id>` always rebinds: `session_bound{supersedes}`, old session file deleted |
| Resolution | Cwd under `.claude/worktrees/factory-<id>` → that run. Else exactly one non-terminal run in the repo → it. Else `{list:[{run_id, stage, last_ts}]}` | None → `{none:true}` | Unknown run id → `NOT_FOUND` |
| Wait | `next --wait 5000` with nothing due and steps in flight | Polls `commands.jsonl` size unlocked until it changes or the wait ends, then answers like `next` | Terminal → `{done:true}` |

</frozen-after-approval>

## Code Map

- `src/core/reducer.ts` -- reuse `apply`, `fold`, `openSteps`, `boardStage`, `isTerminal`. `step_verified` accepts claimed|reported. Don't change any transition.
- `src/core/events.ts` -- `DataByKind`. Add optional `prompt_fact_id`/`human_prompt`/`prompt_text` to `run_started` and `session_bound`.
- `src/store/{jsonl,locks,load-run,ids,paths}.ts` -- reuse `readLines`, `appendLine`, `withLock`, `claimDir`, `loadRun`, `ulid`, `runId`. Paths for `inboxFile`, `consumedDir`, `sessionFile` and `lockDir` already exist.
- `src/cli/main.ts` `VERBS`, `src/cli/args.ts` `flagString` -- register the verbs.
- `test/cli.test.ts` -- the `run()` spawn helper and the temp `FACTORY_HOME` pattern.
- Real transcript user turn: `{type:"user", promptId, sessionId, turnOrigin:"human", message:{content}}`. For a slash command, `content` is `<command-message>…</command-message>\n<command-name>/factory</command-name>\n<command-args>approve intake</command-args>`. Rebuild it as `/<name> <args>`, trimmed, before comparing it with `prompt_text`.
- `claude agents --json` shape is unverified (empty under the sandbox). Look for `sessionId`/`session_id` on each element. If it fails, treat the holder as live.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/decision.ts` -- the Conventions grammar → `{decision:{kind, data}} | {intent:'start', task} | {intent:'resume', run_id?} | {intent:'bare'}`. The first token is a subcommand only on an exact match with valid arity. Also `matchTurn(lines, humanPrompt, promptText, session)`, pure.
- [x] `src/core/cards.ts`, `src/core/schedule.ts` -- `intakeCard()`, and `due(state)` → steps to issue. INTAKE with no open intake step gives one `ask_human`. Every other phase gives `[]` for now.
- [x] `src/store/paths.ts` -- add `claudeProjectsDir()` (`FACTORY_CLAUDE_PROJECTS`) and `claudeAgentsFile()` (`FACTORY_CLAUDE_AGENTS_JSON`, a test-only fixture that stands in for running `claude agents --json`).
- [x] `src/store/sessions.ts` -- atomic session-file write and delete, recording `claude_pid` and `claude_start` (walk ancestors with `ps` to the `claude` process, else null). Also inbox reads, the consumed ledger (mkdir/rmdir plus a `reason` file), the transcript locate, and the liveness read.
- [x] `src/cli/git.ts`, `src/cli/resolve.ts` -- `repoHash` (AD-9), `headSha`; run resolution plus the session and holder checks.
- [x] `src/cli/{start,resume,status,next,claim,done,decide}.ts` + `main.ts` -- the verbs from the matrix. `done <step> [--note|--stdin]` appends `step_reported{note}` (actor `conductor`) for a step this session claimed. `next` returns `{steps, in_flight, wait?, done?}`, with `wait.retry_after_ms` when only in-flight steps remain.
- [x] `test/decision.test.ts`, `test/schedule.test.ts`, `test/driver.test.ts` -- grammar and matcher units. One end-to-end test per matrix row through `bin/factory`, using a temp git repo, `FACTORY_HOME`, projects dir and agents JSON.

**Acceptance Criteria:**
- Given a temp repo and setup, when `start → next → claim → decide(approve intake) → next` runs, then the state is ORIENT, the intake step is verified, and `next` returns `{steps:[], in_flight:[]}`.
- Given the repo, when the Verification commands run, then all tests pass, tsc reports 0 errors, and the fixture shasums are unchanged.

## Design Notes

`decide` consumes only decisions, plus forged or superseded prompts so they can't wedge the queue. `start` and `resume` consume the non-decision prompt themselves and embed it in their command, which satisfies AD-26's "the consuming command embeds the fact". They therefore act only on what the human typed. Decision kinds whose data is built later (gate passes, rework voids, cut) return `ILLEGAL_TRANSITION` "lands in 1-4/1-5". In 1-2 they are unreachable anyway.

## Verification

**Commands:**
- `node --test test/` -- expected: all pass.
- `npm i --prefix "$TMPDIR/tsc" --cache "$TMPDIR/npm-cache" typescript@7.0.2 @types/node@22 && "$TMPDIR/tsc/node_modules/.bin/tsc" -p tsconfig.json --typeRoots "$TMPDIR/tsc/node_modules/@types"` -- expected: exit 0.
- `shasum test/fixtures/*.state.json` before/after -- expected: identical.

## Implementation Notes

- Verification: `node --test test/` 64 pass, 0 fail (Node 26.11.1); tsc 7.0.2 exit 0 (with `--cache "$TMPDIR/npm-cache"`); `test/fixtures/*.state.json` shasums identical.
- New files: `src/core/{decision,cards,schedule}.ts`, `src/store/sessions.ts`, `src/cli/{git,resolve,prompt,commit,start,resume,status,next,claim,done,decide}.ts`; tests `test/{decision,schedule,driver}.test.ts`. `prompt.ts` (take/verify/consume the newest prompt) and `commit.ts` (build, gate with `apply`, append) are shared CLI helpers not named in the Code Map.
- Additive changes: `events.ts` adds `PromptEmbed` (optional `prompt_fact_id`/`human_prompt`/`prompt_text`) to `run_started` and `session_bound`; `config.ts` adds `NEXT_RETRY_AFTER_MS` (5 s) and `WAIT_POLL_MS` (100 ms); `paths.ts` adds `claudeProjectsDir`, `projectTranscript`, `claudeAgentsFile`, `consumedReasonFile`.
- Inbox lines are validated with `validateEvent` (a missing `run` is allowed, since prompts predate binding), must carry the caller's `session` and a path-safe `prompt_id`; the first fact of each kind per `prompt_id` wins. `matchTurn` also requires the two facts to agree (same `prompt_id`/session, `command_name` is `factory` or `d2t-factory:factory`, and `prompt_text`'s args equal `command_args`), so a forged `human_prompt` can't ride on a genuine `prompt_text`.
- Ledger: `consumed/<prompt_id>/reason` is written after the consuming append (`started`, `resumed`, `decided`), or directly for `forged`, `superseded`, `illegal` and `no_run`, so the rollback is a plain `rmdir`.
- Interpretations: (1) A typed `/factory resume` with no id is a takeover like `resume <id>` (AD-25); only a bare `/factory` defers to a live holder. A positional on `start`/`resume` must match what was typed. (2) `resume` returns `{list}`/`{none:true}` without consuming, so `start <task>` can still consume a bare prompt. (3) Holder verbs (`next`/`claim`/`done`/`status`) resolve worktree → the session's own `sessions/<s>.json` → single live run; `decide` non-decisions report the plain worktree → single live → list chain. A decision with no resolvable run is consumed (`no_run`) and returns `NOT_FOUND`. (4) `approve intake` on an intake step that is issued but unclaimed appends `step_claimed` (by the decider) before `step_verified`, since `step_verified` needs claimed|reported and the step would otherwise stay open forever. (5) Buildable decisions now: intake, merge, abandon, rule (no `slice_to` mapping yet); gate1/gate2/rework/cut/keep/rerun/choose (the reducer accepts `design_choice_made` in any phase) return `ILLEGAL_TRANSITION` "lands in 1-4/1-5", consumed. (6) `claude agents --json` liveness runs before the lock (no subprocess under the lock); the holder is re-checked inside and a change is `CLAIM_TAKEN`. (7) `done` on a step claimed by another session is `CLAIM_TAKEN`. `step_claimed` uses actor `cli` like the fixtures.
- A session that holds a live run in the repo can't `start` or `resume` a different one (`BAD_ARGS`), so its session file is never overwritten while that run is live.
- Risk: `ps` is denied under the sandbox, so `claude_pid`/`claude_start` are null whenever the conductor runs `factory` sandboxed; outside the sandbox the walk found the `claude` ancestor. 1-3's `/clear` rebind depends on these fields.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-24): blind-hunter (B), edge-case-hunter (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| B7/E6 | `start` (and `resume` of another run) overwrites the binding of a session that still holds a live run, orphaning that run | medium | `start.ts` never reads the session's current binding; run A keeps `holder: sa` while `sessions/sa.json` names B, so sa's verbs and 1-3's hooks lose A | patch: refuse while the session holds a different live run |
| E8 | `/factory choose a` is appended in INTAKE | low | The reducer accepts `design_choice_made` in every phase and `decide` does not list it as a later decision, so it is consumed as `decided` with no designer question | patch: add it to `LATER` |
| E12 | A late duplicate fact makes an older prompt the newest | low | `readInbox` sets `g.last = i` on every line, so a repeated older `prompt_id` reorders the groups | patch: set `last` only when the group is created |
| E1/E2 | `claim`/`done` on `constructor` or `__proto__` give the wrong error | low | `state.steps` is a plain object, so `steps.constructor` is truthy: CLAIM_TAKEN "step constructor is undefined" instead of NOT_FOUND | patch: `Object.hasOwn` |
| B11/E9 | `--wait` accepts `''`, `1e3` and `9e15` | low | `Number('')` is 0 and `Number.isInteger(1e3)` is true | patch: digits only |
| B14 | `requireRun`'s `runId` param has no caller | low | Dead parameter | patch: remove it |
| V1 | `done` refusing another session's claim is untested | medium (pre-verified) | Inverting `done.ts:26` keeps all tests green | patch: test |
| V2 | A decision with no resolvable run (`no_run`) is untested | medium (pre-verified) | No test greps `no_run`; a plain throw would wedge the queue silently | patch: test |
| V3 | `decide` resolving by binding with two live runs is untested | medium (pre-verified) | Dropping `boundSession` in `decide.ts` keeps all tests green | patch: test |
| V4 | `repoHash` never runs in a real linked worktree | medium (pre-verified) | The worktree test uses `mkdir`, where `--git-dir` and `--git-common-dir` agree | patch: test with `git worktree add` |
| V5 | Object-shaped `claude agents --json` untested | medium (pre-verified) | All fixtures are arrays | patch: test |
| V6 | `claim --agent-id` untested | medium (pre-verified) | No test passes it; agent claims arrive with 1-4's agent steps | defer |
| B21/E14 | `matchTurn` compares the rebuilt `/<name> <args>` string to raw `prompt_text`, so a namespaced `<command-name>` or extra spaces fail a genuine prompt as forged | maybe-false (high if true) | Spike 02 recorded `command_name: d2t-factory:factory` for a typed `/factory approve gate2`, so the transcript may store the namespaced name; no real plugin transcript was available to check | defer: settle with 1-3's real hooks; compare (name ∈ names, args) instead |
| B5/E13 | A genuine prompt caught mid-write (one fact missing, or the transcript turn not yet flushed) is consumed as forged | maybe-false (medium if true) | The prompt hooks are synchronous (AD-13), so both facts likely land before the turn; transcript flush timing is unverified | defer: check under 1-3's real hooks |
| E3 | `factory constructor` exits 0 echoing args | low | The `VERBS[args.verb]` lookup is from 1-1 and unchanged here | defer (pre-existing) |
| B1/E4 | After a takeover, the old session's claimed steps are stuck | false | In 1-2 the only step is the intake card, which `decide` verifies whoever claimed it; orphan reissue is excluded by the frozen Never and owned by AD-24 with 1-4's agent steps | reject |
| B2/E7 | Multi-event appends are not atomic | low | Needs a write failure between two adjacent appends; fix adds a new store writer | reject |
| B3 | Prompts over 32 KiB get truncated inside the embed | low | Task text that large is implausible; fix adds a size policy | reject |
| B4 | A forged newest prompt supersedes genuine older ones | low | The forger must write between the hook and the turn's first `decide`; AD-6 supersedes older prompts anyway | reject |
| B6 | Near-miss subcommands become tasks | false | The Conventions grammar says so ("Otherwise the text is a task"), and intake still gates a new run | reject |
| B8 | A bare-path task comes from the conductor | false | Spec Design Notes accept it; `approve intake` is the gate | reject |
| B9 | `resume` rejects a positional after a bare prompt | false | Intended: a list means the human types `/factory resume <id>` (AD-25) | reject |
| B10 | `next` in ORIENT returns no wait or done | false | The acceptance criterion requires `{steps:[], in_flight:[]}` | reject |
| B12 | Unknown flags are ignored on most verbs | low | The conductor passes fixed flags; fix adds branching to every verb | reject |
| B13 | Resuming a terminal run gives a generic ILLEGAL_TRANSITION | low | The message names the phase and the prompt is superseded next turn | reject |
| B15/E15 | git errors are hidden; git < 2.31 lacks `--path-format` | low | git 2.31 is from 2021; fix adds error branching | reject |
| B16 | `prompt_fact_id` is optional on `run_started` | false | Required would reject the existing fixtures; `v:1` changes are additive (AD-32) | reject |
| B17 | The whole transcript is parsed on every prompt verb | low | Once per human turn; no named harm at session sizes | reject |
| B18 | A re-issued intake step is always attempt 1 | false | The intake step is verified only together with `intake_confirmed`, which leaves INTAKE, so it is never re-issued | reject |
| B19 | The intake card offers only approval | low | The grammar has no `rework intake`; `abandon` remains | reject |
| B20 | `requireSetup`/`stepView` sit in `commit.ts` | false | No caller or rule harmed | reject |
| B21b | Untested: unclaimed `done`, lock races, session-file write failure | low | The reducer refuses `step_reported` from `issued`; the rest needs injected faults | reject |
| B22 | Driver tests leave temp dirs | low | `cli.test.ts` does the same; fix threads cleanup through every test | reject |
| E5 | Holder verbs resolve to a session's terminal run | false | A session's own finished run is the right answer for its verbs; the worktree and an explicit id still win | reject |
| E10 | A non-holder's `next` on a terminal run returns `{done:true}` | false | Read-only answer; it lets a superseded `next --wait` stop | reject |
| E11 | `done --stdin` on a non-blocking pipe or TTY | low | The conductor pipes a heredoc; fix adds stream handling | reject |
| E16 | `rerun Spec` is accepted case-insensitively | low | Lenient, no harm | reject |
