---
review: adversary
target: ../ARCHITECTURE-SPINE.md
date: 2026-10-23
method: For each hole, two units that each obey every AD as written, yet build things that don't fit together. Each hole ends with the minimal AD text that closes it.
counts: {critical: 5, high: 12, medium: 11, low: 5}
---

# Adversarial review: d2t-factory architecture spine

Units are named after the build-order increments (I1 walking skeleton, I2 truth layer + dashboard, I3 full loop, I4 replay, I5 worktrees + parallel) or after the module that implements them (CLI, hooks, reducer, dashboard, conductor skill, agent prompts).

The spine's core weakness is that **it fixes the envelope but not the joins**. Most of the critical holes are places where two writers must agree on a key (`corr`, step identity, artifact schema, prompt arguments), and no AD says what that key is.

---

## CRITICAL

### C1. `corr` is undefined, and hooks cannot compute it

- **AD-4 says:** facts attach to commands by `corr`.
- **The problem:** an async hook only sees the Claude Code payload: `session_id`, `agent_id`, `agent_type`, `tool_use_id`, `tool_input`. It has no access to `step_id`.
- **Hooks builder (I2)** sets `corr = tool_use_id` (or `agent_id`). That is the only correlation key it has, and it complies with AD-4/AD-5.
- **CLI builder (I1/I3)** sets `corr = step_id` on `step_issued` and `step_reported`.
- **Result:** the reducer's verify join never matches. Every claim goes UNVERIFIED after 30 s, and CAP-15's success signal ("every stage and verdict shown as verified") is unreachable.
- **A second issue:** AD-7 says "matching `agent_type`". That doesn't attribute a fact to a step whenever the same type recurs. The builder recurs for every slice and every round, and reviewers recur across pipelined slices.

**Proposed AD-23: Attribution keys.**
> Hooks never compute `corr`; facts carry `corr: null` plus raw join keys (`session_id`, `agent_id`, `agent_type`, `tool_use_id`, normalized `path`).
> On commands, `corr` = the `step_id` for step-scoped kinds (`step_issued`, `step_reported`, `check_ran` for a step); otherwise the `id` of the command that caused it, or null.
> Attribution, in `src/core/verify.ts` only:
> 1. `output_written` → step, by exact match of its realpath'd `path` to a step's `output_path`. Every `output_path` is unique per step and contains the `step_id`.
> 2. That fact's `agent_id` → the step's agent.
> 3. `subagent_started` / `subagent_stopped` → step, via that `agent_id`.
>
> `agent_type` is a consistency check, never a join key. A `resume` step is verified by its own `output_written` only.

### C2. Do claims advance state, and how do facts reach a deterministic fold?

There are three contradictions:

- AD-1 says state = fold(commands + facts).
- AD-4 says commands.jsonl "is the *only* stream that changes state".
- AD-6 says the reducer accepts a decision by *consuming* a fact.

Two compliant builds follow:

- **CLI builder A:** `factory done` appends `step_reported`, and `next` immediately issues the dependent step. The claim is only an overlay. As a result, the pipeline advances on the LLM's say-so, which violates CAP-14.
- **CLI builder B:** `done` fails `MISSING_EVIDENCE` unless the facts are present. But the facts come from **async** hooks (AD-13), so `subagent_stopped` / `output_written` usually land *after* the conductor's immediate `factory done`. The result is a spurious failure on most steps, and the conductor skill (a third builder) has no retry contract.
- **Replay builder (I4):** re-derives fact consumption and verification during the fold. Redaction (AD-18) changes fact contents, so a decision that matched live can fail to match in replay. CAP-16 diverges.

**Proposed AD-24: Commands are self-sufficient; evidence is pinned.**
> Stage and step state is a fold of `commands.jsonl` alone; the fold is total and never rejects (validation happens in the CLI before append). Facts feed only the claim overlay (claimed/verified/unverified) and the CLI's pre-append checks.
> `factory done` always appends `step_reported` (the claim). The CLI appends a separate `step_verified {step_id, evidence:[fact ids]}` command when `next` or `done` observes the AD-7 evidence. Only `step_verified` unblocks dependent steps.
> While a claim is pending, `next` returns `wait`. After `CLAIM_OVERDUE_MS` unverified, `next` re-issues the step once as a new attempt (AD-25), then raises an `ask_human` "Evidence missing" item.
> Any command that consumes a fact embeds it verbatim (redacted) in `data`, so replay needs no fact re-matching.

(This adds `step_verified` to the AD-5 kind list. Amend AD-4's last bullet to: "Facts never change stage state; they are pinned into commands by id.")

### C3. Step lifecycle: "open" conflates issued with in flight, and `CLAIM_TAKEN` has no AD

- **AD-3 says:** `next` returns *open* steps, and re-issues them unchanged on resume.
- **Conductor skill builder:** spawns every step `next` returns, which is what AD-3 literally says. With pipelining, the conductor calls `next` again while reviewers of S1 are running. They are still open, so it spawns them a second time.
- **After `/clear`:** the new conductor can't tell a step that was never started from one whose subagent died with the old session. It either double-spawns or never spawns.
- **CLI builder:** mints step ULIDs inside `next` without persisting them (`next` reads like a query). Re-issue then yields new IDs, which breaks idempotency.
- **`CLAIM_TAKEN`:** the conventions list it as an error code, but no AD defines a step claim.

**Proposed AD-25: Step lifecycle.**
> `factory next` is a mutating command: under the run lock it appends `step_issued` for any newly due step (`step_id` = that event's `id`) and returns steps in state `issued` only.
> Before acting, the conductor runs `factory claim <step_id>`. That appends `step_claimed {session_id}`, or fails `CLAIM_TAKEN` if a live claim exists.
> Lifecycle: `issued → claimed → reported → verified | reissued`.
> A claim held by a session that is not the run's current binding (AD-26) is orphaned. The next `next` appends `step_reissued {old, new}` with a new `step_id`, a new `output_path`, and `attempt+1`.
> `next` output gains `in_flight: [step_id…]` so the conductor waits instead of respawning.

### C4. The run contract, slice plan and spec are parsed by the CLI, but no AD gives their schema

- **The CLI needs to parse:**
  - the run contract: the test/health command (AD-8), the port (AD-20) and the shared DB flag (AD-15);
  - the slice plan: slice IDs, tags, dependency marks, the Gate-2 check (AD-7) and the issue order;
  - the spec: the AC list and "every AC has a check" (Gate 1).
- **The producers are agent prompts** (scaffolder, slicer, spec-writer), and AD-11 fixes only their first line.
- **Slicer prompt builder (I3):** writes a markdown table: `| S1 | Export CSV | ui, input | depends: — |`.
- **CLI builder (I3):** expects YAML frontmatter `slices: [{id, tags, depends_on}]`.
- Both comply, and Gate 2 can never pass.
- **The run contract has two writers:**
  - AD-20 says the CLI claims the port and "records it in the run contract".
  - The run contract is the scaffolder's output file.
  - Who edits whose file is undefined.
- **The roster has two owners:**
  - The slicer could write reviewer names.
  - The CLI could derive the roster from tags, plus INTAKE overrides, plus whether a `design.md` reference exists (review-policy).

**Proposed AD-27: Machine-read artifacts have core schemas.**
> `src/core/artifacts.ts` defines and parses the machine-read parts of three artifacts; agents write them, only the CLI parses them, and a parse failure fails `done` with `MISSING_EVIDENCE` and the parser message.
> - **Run contract:** `run-contract.json` = `{install, start, url, port, test, health, services:[{name, kind, shared:boolean}]}`. The CLI claims the port *before* issuing SCAFFOLD and passes it in the brief. The scaffolder must echo it, and the CLI rejects a mismatch. The CLI never edits the file.
> - **Slice plan:** a fenced ```json block `{"slices":[{"id":"S1","title","acs":["AC-1"],"tags":["ui"|"input"|"auth"|"secrets"|"external"],"depends_on":["S…"],"timebox_ms"?}]}`.
> - **Spec:** acceptance criteria are lines `- AC-<n>: <text> — check: \`<command>\`` or `— page: <path> <expectation>`.
>
> The reviewer roster is never written by an agent: `core/roster.ts` derives it from slice tags, INTAKE overrides recorded on `intake_confirmed`, and the presence of a verified design step.

### C5. Decision matching routes the human's words through the LLM

- **AD-6 says:** the conductor calls `factory decide …`, and the reducer accepts it if a prompt fact's "arguments match".
- **Hook builder:** stores the verbatim prompt `/factory rework "use ship date, not order date"`, or `approve gate-1`, or `approve 1`.
- **Conductor:** re-types those arguments through shell quoting. Whitespace, smart quotes or an escaped `$` cause a mismatch, which is `NO_HUMAN_PROMPT` on a legitimate human decision.
- **"Match" is left to each builder.** It could be exact, normalized or prefix. If the CLI builder normalizes leniently, the LLM's latitude creeps back in.
- **The plugin namespace adds a second mismatch:** `command_name` may be `factory` or `d2t-factory:factory`.

**Proposed amendment to AD-6.**
> `factory decide` takes no decision arguments. It consumes the oldest unconsumed `human_prompt` fact of the calling session whose `command_name` normalizes to `factory`, so `d2t-factory:factory` and `factory` are the same. `core/decision.ts` parses the decision from that fact's `command_args` with a fixed grammar:
> - `approve intake|gate1|gate2`
> - `rework [S<n>] <note…>`
> - `cut S<n>[,S<n>…]`
> - `keep`
> - `rule E<n> <option-key>`
> - `merge`
> - `rerun <stage>`
> - `abandon <run-id>`
> - `resume [run-id]`
>
> If the parse fails, the prompt is consumed as non-decision. If the parse succeeds but the decision is illegal in the current state, the CLI fails with `ILLEGAL_TRANSITION` and the prompt stays unconsumed.

---

## HIGH

### H1. The CLI may not know its own `session_id`, the fallback contradicts AD-9, and `/clear` mints a new session

- **The primary path:** the CLI reads `CLAUDE_CODE_SESSION_ID` to bind the session. AD-9 says the CLI alone writes `sessions/*.json`.
- **The fallback breaks two rules:**
  - The fallback is "a binding fact from the PostToolUse hook on the `factory` Bash call".
  - But that session is unbound, so AD-9/AD-13 require the hook to drop the event.
  - And PostToolUse fires *after* the CLI call, so the first CLI call still can't bind.
- **The spike fallback is a third writer:** it says to match on the "conductor's spawn record in registry", which has the conductor writing the registry.
- **`/clear` mints a new session ID:**
  - The old binding stays live, so two sessions are bound to one run.
  - Two terminals running `/factory` can then both drive the run.
  - The UX promises "Run r-7f3a is already claimed by another session", but no AD backs it.

**Proposed AD-26: Session binding is a claim with one current holder.**
> The CLI learns its session only from `CLAUDE_CODE_SESSION_ID`. If that is absent (spike), the conductor skill passes `--session ${CLAUDE_SESSION_ID}` via skill substitution; no hook ever writes `sessions/`.
> `session_bound {session_id, supersedes?}` makes that session the run's sole current conductor. A bind from a second session while the current one has had a heartbeat within `SIGNAL_LOST_MISSED × HEARTBEAT_INTERVAL_MS` fails `CLAIM_TAKEN`, unless issued by `/factory resume` (an explicit human takeover).
> Every mutating CLI call from a non-current session fails `LOCKED`.

### H2. Inbox adoption has no writer, no consumption ledger, and isn't in recordings

There are three problems:

- **Adoption has no legal writer:**
  - AD-9 says the CLI "adopts" inbox facts when it binds.
  - Copying them into `runs/<id>/facts/` violates AD-4, which says hooks are the only fact writers.
  - Leaving them in the inbox means the dashboard, which tails only `*/runs/**`, never sees the human prompt for `/factory start`.
  - AD-18's recordings would also lack them. Replay then shows `intake_confirmed` with no human evidence.
- **Cross-run consumption:** in a session bound to run A, the human types `/factory resume B`. The hook writes that fact to A's facts, but B's CLI must consume it.
- **Consume-once is per stream:** a prompt fact could be consumed by both run A's and run B's command streams. Each stream's fold sees its own prompt as unconsumed.

**Proposed AD-28: One inbox, a global consume ledger.**
> `UserPromptExpansion` writes every `/factory` `human_prompt` fact to `~/.factory/inbox/<session_id>.jsonl`, bound or not. Hooks never put `human_prompt` in run fact files.
> A fact is consumed by atomic `mkdir ~/.factory/inbox/consumed/<fact-id>`; failure means `CLAIM_TAKEN`. The consuming command embeds the fact (AD-24).
> Inbox files are disposable after the consuming command is appended; recordings need only `runs/`.

### H3. `data` per kind, stage names and ID formats are unspecified

- **What AD-5 closes:** the kind list.
- **What it leaves open:** the payloads.
- **Dashboard builder (I2):** reads `stage_started.data.stage === "RECON"`.
- **CLI builder:** writes `"ORIENT"` (from the state diagram) or `"recon"`.
- **Slice IDs collide with the step contract:** `step_issued.data` could carry `slice` or `slice_id`, and `card?` in AD-3 is an object nobody has defined.
- **`check_ran` is defined twice:**
  - AD-8 describes it as `{command, exit_code, duration_ms}`.
  - The Gate-1/Gate-2 "checks" in AD-7 are internal parse checks, not commands.
- **Run IDs don't agree:** the UX shows `r-7f3a`, but AD-9 says `<slug>-xxxx`.

**Proposed amendment to AD-5.**
> `src/core/events.ts` exports a discriminated union `Event` with a typed `data` per kind and a runtime validator; every writer validates before append; readers ignore unknown `data` fields.
> Stage values are the closed enum `INTAKE | RECON | FRAME | SCAFFOLD | SPEC | DESIGN | SLICE_PLAN | BUILD | WRAP`. This is the board vocabulary; `ORIENT` and `SPEC_DESIGN` are reducer state names only.
> `check_ran.data = {check: "contract.test" | "contract.health" | "git.clean" | "git.merged" | "spec.acs" | "plan.slices", command?, exit_code, duration_ms, sha?, cwd}`.
> `card` is defined in the same module. Run-ID format per AD-9 is authoritative; UX mocks adapt.

### H4. The Stop hook traps conversational turns inside "working" states

- **Under AD-12:** the Stop hook blocks in working states, and parked states are enumerated by name.
- **INTAKE is a back-and-forth with the human:** every assistant turn ends in Stop. INTAKE isn't listed as parked, so the conductor can never yield to the human.
- **The greenfield designer (CAP-6) has the same problem:** it may ask one question during SPEC_DESIGN, which is a working state.
- **A pipelined escalation on S1 parks the run:** but S2's builder is still working. A single-state reducer can't hold both.
- **Hooks builder:** blocks by stage name.
- **Reducer builder:** models parallel slices.
- These two disagree on whether the conductor may stop.

**Proposed amendment to AD-12.**
> "May stop" is a derived predicate in core, `awaitingHuman(state)`: true iff there is ≥1 open `ask_human` step and no step is `claimed` by the current session's agents.
> INTAKE turns, the designer's single question and every escalation are issued as `ask_human` steps. Escalations are slice-scoped; other slices' steps continue.
> The stage-name list in AD-12 is replaced by this predicate.

### H5. Readers of a growing JSONL can parse a partial line

- **The dashboard tails with `fs.watch`.** An event can fire after a hook's write has only partly landed. POSIX doesn't guarantee that a concurrent `read` sees a whole `O_APPEND` write. And libuv `writeSync` can short-write large buffers.
- **Dashboard builder:** splits on `\n`, `JSON.parse`s every piece including the trailing fragment, logs a parse error, and advances its offset. **The event is lost**, and the cache diverges from a cold rebuild, which violates AD-1.
- **CLI builder:** reads whole files inside `next`, so it sees the same fragment.

**Proposed AD-29: JSONL read/write discipline (in `src/store/jsonl.ts`, the only reader and writer).**
> Writers serialize one event, reject lines > 32 KiB (truncate whitelisted fields first), and append `line + "\n"` with one `write` on an `O_APPEND` fd, looping on short writes.
> Readers consume only bytes up to the last `\n`, keep a byte offset there, and retry the remainder on the next tick.
> A newline-terminated line that fails to parse or validate is skipped and logged to `hook-errors.log` with file and offset; it never aborts a fold.
> Events are de-duplicated by `id`.

### H6. Lock semantics: blocking, scope and staleness are unspecified

- **Parallel reviewers each call `factory done` concurrently.**
- **CLI builder A:** returns `LOCKED` at once.
- **Conductor skill builder:** has no retry, so the claim is dropped.
- **CLI builder B:** holds the run lock while running the test suite for `check_ran` (AD-8), which can take minutes. Every other `done` is then `LOCKED` for minutes.
- **A crashed CLI leaves `lock/` behind forever.** Nothing in the spine defines breaking a stale lock.

**Proposed AD-30: Lock protocol.**
> The run lock is held only for fold → validate → append. It is never held across a subprocess.
> Checks run unlocked; the result is appended under the lock with `data.basis_seq` (the command count it ran against). It is rejected `ILLEGAL_TRANSITION` if a state-changing command intervened.
> Acquisition retries with backoff up to 10 s inside the CLI before returning `LOCKED`.
> `lock/owner.json = {pid, host, ts}`. A lock whose pid is dead is broken by `rename` to `lock.stale-<ulid>` and then re-acquired.

### H7. Pipelining in one worktree: slice-N evidence runs against slice-N+1's work in progress

- **The pipelining design:**
  - CAP-8 reviews S1 while S2 builds.
  - AD-8 runs the test command "in the worktree" when a slice closes.
  - AD-22 has every reviewer share the run's single dev server.
- **The CLI builder** runs `check_ran` for S1 in the only worktree, which now holds S2's half-written code. The slice is closed (or failed) on code that isn't S1.
- **UI reviewers of S1** browse a dev server that hot-reloads S2's edits. Their observed page state isn't S1's.
- **Both builders comply.** But the evidence is meaningless, and a seeded bug can pass or fail for the wrong reasons.

**Proposed AD-31: Evidence is pinned to a slice commit.**
> Every builder step ends with a commit on the run branch; `step_reported.data.sha` is required for builder steps, and the CLI checks it is reachable from HEAD.
> `check_ran` for slice close and gates records `sha` and `dirty`. A slice may close only on a `check_ran` with `dirty: false` at a sha containing the slice's last builder commit, run while no builder step is `claimed`.
> Running-app reviewers for slice N are issued only when no builder step is claimed. Otherwise `next` holds them as `wait`, so pipelining applies to diff reviewers only.

### H8. `output_written` emission rules are unspecified

- **AD-7 says:** the fact is "a `Write` to that step's `output_path` … with a first line that parses".
- **Hooks builder A:** emits it only for the `Write` tool and takes the first line from `tool_input.content`.
- **An agent that uses `Edit`, `MultiEdit` or a Bash heredoc** gets no fact, so its claim is UNVERIFIED.
- **Hooks builder B:** emits `output_written` for every Write anywhere. Combined with AD-14, it could leak first lines of product files.
- **Paths can differ:** `~` vs absolute, the symlinked `/private/tmp` vs `/tmp`, or a worktree-relative path vs `output_path`. Any of these breaks the C1 join.
- **AD-2 contradicts reality:** it says agents "write only to the `output_path` their step names", but builders write product code. A hooks builder enforcing AD-2 would flag every builder edit.

**Proposed AD-32: `output_written` emission.**
> The `PostToolUse` hook for `Write|Edit|MultiEdit` emits `output_written` iff the realpath of `file_path` lies under `runs/<bound-run>/artifacts/`. `data.first_line` is read from disk after the write (redacted, ≤ 200 chars); `data.path` is the realpath.
> All other successful tool calls emit `tool_succeeded` with whitelisted fields only.
> Agent prompts must write output files with `Write`.
> AD-2's last clause becomes: "write factory artifacts only to their step's `output_path`; product code only inside the worktree".

### H9. The findings block format is undefined, and nobody owns running the full parser

- **AD-11 says:** a finding has `category`, `failure_scenario` and `location`, and "a block missing any … is rejected by the parser".
- **AD-14 says:** facts store only the first line. The hooks can't parse findings.
- **The reviewer-prompt builder** writes `### Finding 1` with bold labels.
- **The parser builder** expects YAML list items.
- **Who rejects, and what happens next, is undefined.** The step might fail, the reviewer might be re-run, or the finding might be dropped.
- **The verdict has two possible sources:**
  - the `first_line` in the fact,
  - or the file re-read at `done` time, after the reviewer may have rewritten it.

**Proposed amendment to AD-11.**
> After line 1, each finding is a fenced block ` ```finding ` containing exactly `category: …`, `location: <path>:<line> | <url>#<state>`, `failure_scenario: …` (one line each, in that order).
> The CLI runs `core/output.ts` on the file at `factory done`. A parse error fails `done` with `MISSING_EVIDENCE` and the step stays `claimed` (the conductor resumes the same agent to fix the file).
> The verdict of record is the parsed file content whose hash matches the last attributed `output_written` before `step_reported`; it is embedded in `step_verified.data` (AD-24).
> Escalation reason labels are the closed set in `src/core/events.ts`: `Scope change | Spec ambiguity | Irreversible action | New dependency | Non-convergence | Over time box | Taste disagreement | Scaffold failed`.

### H10. The build order breaks ADs, and reducer evolution breaks older recordings

- **I1 (walking skeleton) has no hooks:** truth layer = I2.
- **Under AD-6:** I1's CLI must reject every gate with `NO_HUMAN_PROMPT`, so I1 can't demo.
- **An I1 builder bypasses the check.** That's an undocumented mode, and it complies with nothing.
- **I4 replays "recordings from increments 1–3"** with an I4 reducer. Those recordings lack:
  - events added in I3: slices, `gate_2_passed`, `step_claimed`;
  - the `data` fields above.
- **The result:** the I4 reducer rejects them or folds them wrong.
- **The fixtures are used for regression too**, so every reducer change breaks the test suite, or someone regenerates the fixtures and the regression coverage disappears.

**Proposed AD-33: Schema evolution and the minimum truth slice.**
> I1 ships the `UserPromptExpansion` hook, session binding, and `output_written` / `subagent_*` facts. I2 adds the dashboard only.
> Event changes within `v:1` are additive (new kinds, new optional `data` fields). The reducer folds any `v:1` stream; missing later stages fold as "not reached".
> A breaking change bumps `v` and ships an upcaster in `core/upcast.ts`; readers upcast on read, and files are never rewritten.
> Every recording is a fixture whose folded snapshot must stay byte-identical unless the change is deliberate.

### H11. Artifact layout, brief authorship, and post-gate mutation

- **Brief authorship has three readings:**
  - AD-3 says the conductor turns a rework note into a builder brief, so the conductor writes `brief_path`.
  - AD-2 says skills write only to `output_path`.
  - A CLI builder might generate briefs itself.
- **Fixed names make rework destructive:**
  - AD-10 lists `spec.md`, `design.md` and the slice plan as fixed names.
  - The second spec-writer round (after rework) overwrites `spec.md`.
  - The Gate-1 evidence for round 1 and the replay's view of what was approved are lost.
- **Gate approvals aren't pinned to content.** A builder can edit `spec.md` after Gate 1. The approval still stands, but it now covers different content.

**Proposed AD-34: Artifact layout and immutability.**
> `src/store/paths.ts` assigns `runs/<id>/artifacts/steps/<step_id>/{brief.md,out.<ext>}`. There are no fixed artifact names; each brief lists its input paths explicitly. The "current spec" is the output of the latest verified spec step, a reducer query.
> The CLI is the only writer of `brief.md`. Conductor-authored content (rework translations, gate summaries) enters as `--note`/`--stdin` on `factory done` or `factory decide` and is rendered into the next brief by the CLI.
> Gate and acceptance commands record `sha256` of each approved artifact. A later `output_written` to an approved path, or a hash mismatch at the next gate or merge, raises `MISSING_EVIDENCE`.

### H12. Can a model-invoked skill forge a `human_prompt`?

- **The plugin's `/factory` skill is model-invocable by default.**
- **If the model** invokes the skill via the Skill tool with args `approve gate1`, does `UserPromptExpansion` fire? AD-6's integrity depends on the answer. The spine doesn't say, and the spike list doesn't test it.
- **Hooks builder:** listens to `UserPromptExpansion`. To be safe, it also emits `human_prompt` from `PreToolUse:Skill`.
- **Result:** the LLM can now approve gates. That complies with AD-6's wording but defeats its purpose.

**Proposed addition to AD-6 (and to the spike table).**
> `skills/factory/SKILL.md` sets `disable-model-invocation: true`. `human_prompt` is emitted only from `UserPromptExpansion`, never from any tool hook.
> Spike: confirm a model-initiated Skill call does not fire `UserPromptExpansion`. If it does, the fact must carry and require a payload field that distinguishes user input; otherwise CAP-14 fails.

---

## MEDIUM

### M1. `now` leaks into state, and time sources are unclear

- **AD-17 has the reducer compute** the time box and cut from `now`.
- **Dashboard builder:** folds with its own `now`.
- **CLI builder:** folds with its own `now`.
- **If time-derived conditions are state** (`PARKED_CUT`), the two views disagree, and the cold-rebuild equality in AD-1 fails: a rebuild at a later `now` gives a different board.
- **Async hooks run seconds after the event.** A fact `ts` is the time the hook wrote it, not when the event happened.
- **Undefined:** whether the time box pauses while parked at an escalation.

**Proposed amendment to AD-17.**
> `now` influences only derived flags (`overdue`, `at_risk`, `timebox_exceeded`, `signal_lost`), never stage or step state. A time-driven transition exists only as a command the CLI appended (`cut_proposed`, `escalation_raised{reason:"Over time box"}`).
> Fact `ts` is the hook process's wall clock at write time; facts are ordered by `(ts, id)` for display only.
> The slice time box counts wall time from `slice_started` minus time with an open escalation on that slice. The budget clock never pauses.

### M2. Rerun and rework don't specify downstream invalidation or a target

- **Rerun:** `/factory rerun SPEC` after `gate_2_passed`.
  - **Reducer builder:** voids Gate 1 and Gate 2.
  - **Dashboard builder:** keeps the Gate-2 seal.
- **Rework in BUILD:**
  - **UX:** says `/factory rework <note>` can target a slice.
  - **State diagram:** shows rework only at gates.
  - **AD-6 grammar:** has no slice argument.

**Proposed AD-35: Rerun and rework semantics.**
> `stage_rerun_requested{stage}` and `rework_requested{target: "gate1"|"gate2"|"S<n>", note}` record `data.voids: [event ids]`: every later gate pass, `step_verified` and `slice_closed` that depends on the target. The reducer and every projection treat voided events as superseded (shown struck, never as current).
> A slice rework does not count toward `MAX_RETRIGGER_ROUNDS`.
> Rerunnable stages are RECON/FRAME, SPEC, DESIGN, SLICE_PLAN, and only from a parked state.

### M3. Branch naming has two owners, and the base commit is unpinned

- **The owners:**
  - AD-9 says branch `factory/<slug>` with a `-2` suffix on collision.
  - AD-15's `WorktreeCreate` hook creates it.
- **CLI builder:** picks the suffix at `run_started`.
- **Hook builder:** picks the suffix at create time.
- **Two concurrent runs both compute `-2`.**
- **RECON maps the main checkout at its current HEAD.** If the user commits before SCAFFOLD, the worktree is based on a different commit than the map.

**Proposed amendment to AD-9/AD-15.**
> Branch = `factory/<run-id>`. It is unique by construction, so the suffix rule is deleted.
> `run_started.data.base_sha` pins the base. RECON keys its cache on it, and `WorktreeCreate` creates the worktree at that sha.
> The hook derives everything from the name `factory-<run-id>` plus the folded `run_started`.

### M4. Two runs write the RECON cache concurrently

- **AD-10 caches the map** at `recon/<base-sha>.md`.
- **Recon prompt builder:** uses the cache path as `output_path`.
- **Two concurrent runs** on the same sha both write it. The C1 path join can't tell which run's agent produced it.

**Proposed amendment to AD-10.**
> Recon writes only to its step `output_path`. After `step_verified`, the CLI publishes it to `recon/<base-sha>.md` via write-temp + `rename`, only if absent.
> On a cache hit, `next` skips RECON with `stage_completed{reused: "<sha>"}`.

### M5. The dev server has no owner

- **AD-22 says** "one dev server per run, started at SCAFFOLD, shared".
- **Scaffolder prompt:** starts it in background Bash. It dies with the session on `/clear`.
- **Reviewer prompts:** "start it if it's down". Two reviewers then start two servers, and the second fails on the port or binds to another one.

**Proposed AD-36: Dev server ownership.**
> Only the CLI starts and stops the dev server: `factory serve` (detached, port from run contract, pid in `runs/<id>/devserver.pid`), invoked by `next` before issuing any running-app step and restarted if the health check fails. Agents never start or kill servers.
> It is stopped on `run_completed`, `run_abandoned` or `run_parked` at MERGE.

### M6. The merge has no executor

- **CAP-13 says:** "the factory resolves conflicts and re-verifies".
- **Conductor builder:** runs `git merge` itself via Bash.
- **CLI builder:** runs the merge inside `factory decide merge`.
- **Both comply.** If both run, the merge happens twice, or a conflicted state is reported as `merged`.

**Proposed amendment to AD-8/AD-6.**
> After `merge_approved`, the CLI alone performs the merge (or `gh pr create`), then records `check_ran{check:"git.merged"}` and `merged`.
> Conflicts produce a `spawn` builder step with the conflict list; the CLI re-runs tests and reviewer-code before re-raising MERGE.

### M7. Redaction timing, its value source, and the recording layout

- **AD-14 says** all redaction goes through `redact.ts`, but not *when*.
- **Hooks builder:** relies on the recorder to redact. Live logs and the live dashboard then hold secrets, such as a token pasted into a `/factory rework` note.
- **Recorder builder:** relies on the hooks having redacted already.
- **`.env` values** are known only to the `WorktreeCreate` hook. No AD says where it puts them so later writers can redact them.
- **Multi-run recording layout is undefined** (recorder vs replay builder).

**Proposed amendment to AD-14/AD-18.**
> Redaction runs at write time in every writer (CLI, hooks) and again in `factory record`; `redact()` is idempotent.
> `WorktreeCreate` writes the copied secret values to `runs/<id>/redact.json` (mode 0600, never recorded); writers load it.
> A recording = `recordings/<name>/{manifest.json, runs/<run-id>/{commands.jsonl,facts/*}, transcripts/}`. `factory record <name> --runs <id>[,<id>…]` copies only the named runs.

### M8. `run_abandoned` has no writer; SIGNAL LOST is uncomputable in replay

- **AD-20 reclaims a port** when its run is "SIGNAL LOST and abandoned".
- **No human command writes `run_abandoned`.**
- **UX:** says an abandoned run just "never resumes".
- **SIGNAL LOST depends on `claude agents --json`,** which isn't in the log, so replay can't reproduce it.
- **Dashboard builder and CLI builder** each poll it, each with its own threshold.

**Proposed amendment to AD-20/AD-21.**
> `run_abandoned` is written only by `/factory abandon <run-id>` (add to the AD-6 set) or by a successful `CLAIM_TAKEN` takeover that the human confirms.
> SIGNAL LOST is a dashboard-only display flag. The CLI never reads it; port reclaim requires a recorded `run_abandoned`.

### M9. `wait` steps have no semantics

- **Conductor builder:** busy-loops `factory next` (a token burn) on `wait`.
- **Another builder:** ends the turn, and the Stop hook blocks it (working state), which also loops.

**Proposed amendment to AD-3.**
> `wait` carries `{until: "facts"|"agents", retry_after_ms}`. The conductor runs `factory next --wait <ms>`, which blocks in the CLI (unlocked, polling the store) up to `retry_after_ms` and returns the new step list.

### M10. "The same finding bounced twice" requires a finding identity nobody defines

- **The reducer builder:** counts builder rounds per slice.
- **The dashboard builder:** fingerprints findings by `location`.
- **The `round n/2` display and the `Non-convergence` trigger disagree.**

**Proposed amendment to AD-21/review-policy binding.**
> Non-convergence = the slice's findings round count reaches `MAX_RETRIGGER_ROUNDS` with any `FINDINGS` verdict outstanding; a round = one builder `resume` step issued in response to `FINDINGS`. No finding identity is computed.

### M11. The UX shows hook-observed test runs as VERIFIED; AD-8 says they are only supporting evidence

- **UX:** the Evidence drawer reads "`npm test -- orders/export`, exit 0, claimed by Brix → verified by hook".
- **Dashboard builder:** implements the UX as shown.
- **CLI builder:** implements AD-8, where only `check_ran` verifies.
- **Result:** the board can show VERIFIED while the CLI refuses to close the slice.

**Proposed amendment to AD-7.**
> The only fact-backed verifications are the rows of AD-7; `tool_succeeded` for test commands renders as "supporting", never VERIFIED. The UX evidence row cites `check_ran` (actor `cli`).

---

## LOW

- **L1. `cache.sqlite` has an unclear owner.** A CLI builder might use it to speed up the bare `/factory` run list, which risks schema and migration clashes with the dashboard. *AD-16 add:* "Only the dashboard server opens `cache.sqlite`; the CLI folds JSONL directly."
- **L2. The `agent` field's form is unspecified.** `next` may return `builder` or `d2t-factory:builder`. *AD-3 add:* "`agent` is the full namespaced type, passed verbatim as `subagent_type`."
- **L3. The dashboard singleton can race.** Two simultaneous `factory start` calls each find no pid and spawn a dashboard. *AD-16 add:* "The port bind is the only lock; the pidfile is written after a successful bind; the loser exits 0."
- **L4. Run lookup from a worktree's cwd is unspecified.** In the fallback `.claude/worktrees/factory-<run-id>` path, the run ID must come from the directory name. *AD-9 add:* "Run-from-cwd = parse `factory-<run-id>` from the worktree directory name in both placements."
- **L5. `ask_human` content has no owner.** The conductor writes the gate summary, but the dashboard card text must come from events. *AD-3 add:* "The `ask_human` step carries a core-defined `card`; the conductor's summary is submitted via `--note` and stored on `gate_raised.data.summary`."

---

## New or amended ADs at a glance

| Hole | Fix |
| --- | --- |
| C1 | New AD-23 (attribution keys); amend AD-4 `corr` bullet |
| C2 | New AD-24 (self-sufficient commands, `step_verified`) |
| C3 | New AD-25 (step lifecycle, `step_claimed` / `step_reissued`) |
| C4 | New AD-27 (artifact schemas, roster derivation) |
| C5 | Amend AD-6 (grammar parsed from the fact, `approve intake`, `abandon`) |
| H1 | New AD-26 (session binding claim) |
| H2 | New AD-28 (inbox and consume ledger) |
| H3 | Amend AD-5 (typed `data`, stage enum) |
| H4 | Amend AD-12 (`awaitingHuman` predicate) |
| H5 | New AD-29 (JSONL discipline) |
| H6 | New AD-30 (lock protocol) |
| H7 | New AD-31 (sha-pinned evidence) |
| H8 | New AD-32 (`output_written` rules) |
| H9 | Amend AD-11 (finding format) |
| H10 | New AD-33 (schema evolution, minimum truth slice in I1) |
| H11 | New AD-34 (artifact layout, immutability) |
| H12 | Amend AD-6 (model-invocation guard) |
| M1 | Amend AD-17 |
| M2 | New AD-35 (rerun and rework semantics) |
| M3 | Amend AD-9 / AD-15 |
| M4 | Amend AD-10 |
| M5 | New AD-36 (dev server ownership) |
| M6 | Amend AD-8 / AD-6 (merge executor) |
| M7 | Amend AD-14 / AD-18 |
| M8 | Amend AD-20 / AD-21 |
| M9 | Amend AD-3 (`wait`) |
| M10 | Amend AD-21 (non-convergence) |
| M11 | Amend AD-7 |

New kinds for AD-5: `step_claimed`, `step_reissued`, `step_verified`. The proposed `rework_requested{target}` reuses an existing kind.
