---
reviews: ../ARCHITECTURE-SPINE.md
lens: good-spine rubric (divergence coverage for epics 0-5, Rule enforceability, Deferred safety, tech currency, spec coverage, dimension coverage incl. operational envelope, internal consistency, decisions-not-rationale)
driving_spec: ../../../../specs/spec-poc-factory-plugin/SPEC.md (+ build-order.md, pipeline-stages.md, review-policy.md, truth-layer.md)
date: 2026-10-23
---

# Spine Review: d2t-factory

## Verdict

**Not ready to build on. Revise before epics start.** The paradigm is sound: one reducer, an LLM treated as an untrusted client, and single-writer streams. Most ADs have real, testable Rules. Paths are consistent across the ADs, all three mermaid blocks parse, and every named version checks out as current.

The weak points are the contracts between the units that the epics will build separately:

- **How facts join to claims.** The `corr` key is never defined.
- **What agents hand to the CLI.** The run contract and slice plan have no machine-readable format.
- **How slices move concurrently.** The state machine covers the run only, not individual slices.
- **How intake is confirmed.** The confirmation is not a human-typed command.
- **What a recording is.** The format is deferred, but recordings must be produced before the epic that would define it.
- **Operations.** The dev-server lifecycle, stale locks, abandonment and greenfield identity are not covered.

One Rule as written would break every non-factory Claude Code session that uses worktrees. There is no Open Questions section, so spike-dependent decisions have nowhere to land.

| Severity | Count |
| --- | --- |
| Critical | 1 |
| High | 10 |
| Medium | 12 |
| Low | 11 |

## What passes

- **Tech currency.** Checked 2026-10-23:
  - npm registry: svelte 5.57.2, vite 8.3.5, @sveltejs/vite-plugin-svelte 7.3.1, agent-browser 0.39.2, @playwright/mcp 0.0.83 and typescript 7.0.2 (`latest`) are all current.
  - nodejs.org index: Node 26.12.1 is current. It is not yet flagged LTS, which is informational only.
  - Claude Code 2.1.309 is current. Its binary contains `UserPromptExpansion` (with `command_name`, `command_args` and `prompt`), `WorktreeCreate` / `WorktreeRemove`, `SubagentStart`, `PostToolUseFailure`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PLUGIN_DATA`, `userConfig`, `stop_hook_active` and `claude agents --json`.
- **Mermaid validity.** All three blocks parse with mermaid 11: two `flowchart-v2` and one `stateDiagram`.
- **Path consistency.** The `runs/<run-id>/{commands.jsonl, facts/, artifacts/, lock/}`, `worktrees/<run-id>` and `recon/<base-sha>.md` paths and port 4870 agree across AD-4, AD-9, AD-10, AD-15, AD-16 and the Structural Seed.
- **UX hand-offs resolved.** The dashboard port, heartbeat and SIGNAL LOST threshold, claim-overdue window, event names and verdict vocabulary are all decided (AD-5, AD-11, AD-16, AD-21).
- **Deferred items that are safe.** Dashboard actions, OTel, lane archive, Windows and public distribution cannot cause units to diverge.

## Findings

### Critical

**C1. The WorktreeCreate hook takes over every worktree creation, and AD-13 tells it to return nothing for non-factory cases**

- **Location:** AD-13 (first bullet), AD-15 (second bullet).
- **Issue:**
  - Once a `WorktreeCreate` hook is configured, Claude Code delegates worktree creation to it entirely. The hook must print the absolute path on stdout. Claude Code 2.1.309 fails with "WorktreeCreate hook failed: hook succeeded but returned no worktree path" otherwise.
  - The plugin is installed user-level, so the hook fires in every session in every repo. That includes `EnterWorktree` calls and subagent `isolation: worktree` calls from other tools.
  - AD-13 says that for unbound sessions every hook "exits 0 silently with no output". AD-15 says other names "get the default `git worktree` placement" as though Claude Code still did that itself.
  - Implemented as written, every non-factory worktree breaks. That directly violates the constraint "Factory worktree hooks never alter non-factory worktree sessions". The memlog decision ("replicates default git placement for other names") was lost in the spine.
- **Fix:**
  - Amend AD-15. For any name not matching `factory-*`, and for any unbound session, the hook itself must perform Claude Code's default placement: `git worktree add <repo>/.claude/worktrees/<name>` on the default branch naming. It prints that normalized absolute path and exits 0. `WorktreeRemove` must do the same for removal.
  - Exempt `WorktreeCreate` and `WorktreeRemove` from AD-13's "no output" rule.
  - Add "non-factory fall-through produces a working worktree, in a factory-bound session and in an unbound one" to the spike's pass criterion.

### High

**H1. The claim-to-fact join key (`corr`) is never defined for facts**

- **Location:** AD-4 (last bullet), AD-5 (envelope), AD-7.
- **Issue:**
  - "Facts attach to commands by `corr`", but hooks never see a `step_id`. Hook payloads carry `session_id`, `agent_id`, `agent_type`, `tool_input` and `tool_use_id`.
  - AD-7 verifies "subagent_started with matching `agent_type`". Several steps share an agent type (reviewer-code on S1, S2 and S3, and pipelined builder rounds), so `agent_type` alone cannot say which step a fact belongs to.
  - The hooks epic (2) and the CLI/reducer epic (1) will each invent their own join.
- **Fix:** Add a Rule to AD-4 or AD-7.
  - Every spawn or resume prompt the conductor sends starts with the marker line `factory-step: <step_id>`.
  - The `PreToolUse` / `PostToolUse` hook on the `Agent` tool reads the marker from `tool_input`. It writes the fact with `corr = step_id` and records `agent_id → step_id`.
  - Later facts from that `agent_id` (subagent_*, tool_*, output_written) inherit `corr` through that mapping.
  - `output_written` additionally matches the step's `output_path`.
  - A fact with no resolvable `corr` is stored with `corr: null` and never verifies a claim.

**H2. The artifacts the CLI must parse have no machine-readable contract, and roster computation has no owner**

- **Location:** AD-3, AD-7 (Gate 1 and Gate 2 checks), AD-10, AD-15 (shared DB), AD-20 (port in the run contract), AD-17 (time limit).
- **Issue:**
  - The CLI depends on fields that LLM agents write in prose artifacts:
    - Intake notes: time limit, slice time box, UI-free flag, reviewer override.
    - Context artifact: origin and `ui_surface`.
    - Run contract: install, start, URL/port, test, health, stateful services with shared flag, and e2e tooling.
    - Spec: acceptance criteria with checks.
    - Slice plan: IDs, tags and dependency mark.
  - AD-11 fixes only the first line and the finding shape.
  - The agent prompts (epics 1 and 3) and the CLI parser will diverge, and Gate 1 and Gate 2 "evidence checks" are unimplementable without a format.
  - CAP-2 (the override shows up in every affected roster) and review-policy's roster rules don't say whether core or the slicer LLM computes the roster. The rules in question are "reviewer-ui only with a reference" and "folds into reviewer-ux".
- **Fix:** Add an AD, "Artifact front-matter contracts".
  - Each CLI-consumed artifact carries YAML front matter with a schema in `src/core/artifacts.ts`, parsed only there:
    - `intake.md`: `{limit_min, slice_timebox_min, ui_free, reviewer_overrides}`.
    - `context.md`: `{origin: brownfield|greenfield, ui_surface, ui_reference}`.
    - `run-contract.md`: `{install, start, url, port, test, health, e2e?, stateful_services:[{name, shared}]}`.
    - `spec.md`: `acceptance:[{id, check:{kind: command|page, ...}}]`.
    - `slice-plan.md`: `slices:[{id, title, tags:[ui|input|auth|secrets|external], depends_on:[]}]`.
  - The reducer computes rosters from tags, overrides and `ui_reference` using the review-policy table. The slicer only tags.

**H3. The state diagram is run-level only, so pipelined slices and per-slice parking can't be represented**

- **Location:** Structural Seed state diagram, AD-12, AD-5.
- **Issue:**
  - **Concurrent slices.** UX Flow 1 step 7 and CAP-8 need S2 in review while S4 is escalated and S3 is building. The diagram's `BUILD --> PARKED_ESCALATION` parks the whole run.
  - **Partial cut.** `cut <slices>` can cut a subset, yet `cut_decided (cut)` goes straight to WRAP.
  - **Escalations outside BUILD.** AD-11 lets any agent `ESCALATE` (spec-writer ambiguity, slicer, scaffolder new dependency), but only BUILD has an escalation edge.
  - **Abandonment.** `run_abandoned` exists, but there is no ABANDONED terminal state. AD-12 speaks of "terminal states", plural.
  - **Missing transitions.** There are none for `stage_rerun_requested`, slice-level `rework`, or `run_parked` / `run_resumed`.
  - The reducer (epic 1/3), the dashboard (epic 2) and the Stop hook will each fill these gaps differently.
- **Fix:**
  - Add a slice sub-machine: `BACKLOG → BUILDING → IN_REVIEW ⇄ FINDINGS_QUEUED → CLOSED | ESCALATED | CUT`.
  - Define "parked" as derived: every open step is `ask_human`. AD-12 then blocks Stop iff some open step is not `ask_human`/`done`.
  - Add `ESCALATED` edges from every agent-running stage.
  - Make partial cut return to BUILD.
  - Add ABANDONED as a terminal state.
  - Define rerun: it invalidates downstream gates, and the run re-enters at that stage.
  - Drop `run_parked` (parking is derived), or state what it adds.

**H4. Intake confirmation and abandonment are not typed human commands, and the command grammar is open**

- **Location:** AD-6 (closed set), the state diagram `INTAKE --> ORIENT: intake_confirmed (human)`, AD-7 table, AD-20 ("abandoned").
- **Issue:**
  - `intake_confirmed` is shown as a human decision, and UX seals it as `intake confirmed · Master d2t`. CAP-2 also requires that no spec exists until the human confirms. Yet AD-6's closed set has no intake command, and AD-7 has no row for it. The conductor would assert it from chat, which is exactly the LLM-asserted approval AD-6 exists to prevent.
  - There is no `/factory abandon`, so `run_abandoned` has no source. AD-20's port reclaim then hangs on an undefined trigger.
  - Argument grammar is unspecified: `approve <gate>` (`1`? `gate-1`?), `cut <slices>` (separator), `rule <escalation> <choice>` (escalation ID format, choice vocabulary). The reducer matches "arguments" literally against `command_args`, so the skill text and the parser will disagree.
  - The UX "Every tag shows `/factory resume <run-id>`" flow isn't reconciled with the decision commands.
- **Fix:**
  - Add `/factory go` (or `approve intake`) and `/factory abandon <run-id>` to AD-6 and AD-7.
  - Put a grammar table in Consistency Conventions: `approve 1|2`, `cut S<n>[,S<n>…]|keep`, `rule E<n> <choice>` with escalation IDs `E1`, `E2`, … per run, `rerun <stage-name>`.
  - Have `src/core` own the single parser that both the human_prompt matcher and `factory decide` use.
  - Accept `command_name` both as `factory` and as the namespaced `d2t-factory:factory`.

**H5. AD-2's prompt rule is unenforced, so the LLM can forge the evidence the truth layer trusts**

- **Location:** AD-2 (last bullet), AD-6, AD-9 (inbox), AD-13 (only async fact hooks).
- **Issue:**
  - "Skills and agents never read or write `~/.factory/**/*.jsonl`" is prompt text only. The conductor or a builder can `echo` a `human_prompt` line into `facts/` or `inbox/`, or edit `sessions/*.json`, and AD-6's consumption check passes.
  - Separately, nothing stops the model from invoking the `factory` skill through the Skill tool. Whether `UserPromptExpansion` fires only on human-typed expansion is unverified.
  - This is the claim d2t must defend "unaided" in the interview (Success signal).
- **Fix:**
  - Add a synchronous `PreToolUse` guard to AD-13 for `Bash|Write|Edit|NotebookEdit` in factory-bound sessions. It denies any path under `~/.factory/` other than the step's own `output_path`, and allows `factory …` invocations.
  - Set `disable-model-invocation: true` in `skills/factory/SKILL.md` front matter.
  - Add a spike criterion: a model-initiated Skill call produces no `UserPromptExpansion` with `expansion_type: slash_command`.
  - Record the residual risk (Bash obfuscation) as an Open Question.

**H6. The recording format is deferred to epic 4, but recordings must be produced in epics 1–3**

- **Location:** Deferred ("Exact transcript snapshot format... decided in the replay epic"), AD-18, AD-14 (fact whitelist), build-order increment 4 ("recordings from increments 1–3").
- **Issue:**
  - The build order replays recordings made in increments 1–3, and transcripts expire in about 30 days. If the format is decided in epic 4, either the earlier recordings are unusable or epic 4 must accept whatever epics 1–3 happened to write. That is a cross-epic divergence, so it cannot be deferred.
  - AD-14's fact whitelist omits `transcript_path` and `agent_transcript_path`, so `factory record` cannot locate the transcripts.
  - AD-18 records "the run's" streams. CAP-16's multi-run recording (epic 5) needs one recording spanning several runs that WRAP at different times.
- **Fix:**
  - Decide the format now: `recordings/<name>/manifest.json {v, name, recorded_at, plugin_version, runs:[{repo_hash, run_id}]}`, plus `runs/<run-id>/…` (verbatim JSONL tree, redacted), plus `transcripts/<session_id>[-<agent_id>].jsonl` (raw Claude Code transcript lines, redacted line by line).
  - Add the transcript paths to the AD-14 whitelist.
  - Make `factory record <name> [--run <id>…]` available from epic 1.
  - Move only the replay UI to epic 4.

**H7. The dev-server process lifecycle is undefined, and the operational envelope denies it exists**

- **Location:** Operational envelope ("The only long-lived process is the dashboard"), AD-20, AD-8 (health check), AD-22 ("single dev server").
- **Issue:**
  - Each run has a dev server, started at SCAFFOLD and shared by reviewers (pipeline-stages Run contract). The spine never says who starts it (conductor Bash in the background, or the CLI detached), where its PID and logs live, or how it survives `/clear`. It also doesn't say who restarts it on resume or kills it at WRAP or abandon.
  - The port is released "on run_completed" whether or not the process is dead.
  - Without an owner, it gets orphaned, leaves ports stuck, or is started twice.
  - Nothing says how the port reaches the app (env `PORT`?).
- **Fix:** Add an AD, "The CLI owns run processes".
  - `factory` spawns the run contract's `start` command detached, with `PORT=<claimed>`. It writes `runs/<id>/devserver.{pid,log}`.
  - `next` and `resume` health-check it and restart it if it is dead.
  - The CLI kills it before releasing the port on `run_completed` or `run_abandoned`.
  - Update the operational envelope to list it.

**H8. Greenfield runs have no identity before `git init`**

- **Location:** AD-9 (`repo-hash` from `git rev-parse --git-common-dir`; run-ID claim under `<repo-hash>/runs/`), AD-15, pipeline-stages (SCAFFOLD does `git init`).
- **Issue:**
  - The run ID is claimed at start (INTAKE) under `<repo-hash>/`. A greenfield directory has no git repo until SCAFFOLD, so `repo-hash` is undefined. After `git init`, any hash derived from the new `.git` would differ from whatever was used before.
  - The worktree also needs a base commit (CAP-3, epic 5). Epic 1 (brownfield) will hard-code a git-based identity that epic 5 cannot satisfy.
- **Fix:**
  - Define `repo-hash = sha256(realpath(dirname(git-common-dir)))` for non-bare repos, and `sha256(realpath(cwd))` when cwd is not in a repo. For a fresh `git init` in cwd these coincide.
  - Have `paths.ts` own this.
  - State that greenfield INTAKE and FRAME run in the target directory, and that SCAFFOLD's initial commit precedes `enter_worktree`.

**H9. Crash recovery has gaps: stale locks, locks held during long checks, and abandonment tied to a dashboard-only signal**

- **Location:** AD-4 (`mkdir` lock), AD-8 (CLI runs tests), AD-20 (reclaim "SIGNAL LOST and abandoned"), CLI error code `LOCKED`.
- **Issue:**
  - A CLI killed while holding `runs/<id>/lock/` leaves the run locked forever, and the result is `LOCKED` mid-interview.
  - If the lock is held while AD-8 runs a multi-minute test suite, parallel steps' `factory done` calls fail with `LOCKED`.
  - SIGNAL LOST is computed by the dashboard (AD-21), so the CLI cannot use it to reclaim ports.
- **Fix:**
  - Write `lock/owner.json {pid, host, acquired_at}`. Break the lock if the PID is dead or it is older than `LOCK_STALE_MS` (add this to AD-21).
  - Hold the lock only for the append. Run checks unlocked, then append `check_ran`.
  - Make port reclaim depend only on the owning run's fold being terminal (`run_completed` or `run_abandoned`).

**H10. The Node runtime on PATH is not pinned, and the target repo can swap it out**

- **Location:** AD-19, Stack (Node ≥ 26.5.1), Structural Seed (`bin/factory` "node shim", `hooks.json` "node src/hooks/main.ts").
- **Issue:**
  - Hooks and the CLI rely on `node:sqlite` and native type stripping, which need Node ≥ 26.5.1. They invoke a bare `node` from PATH.
  - Brownfield interview repos commonly pin an older Node with `.nvmrc`, `.node-version` or volta. The run contract's install or start (or the builder) may switch to it. Every hook would then fail silently into `hook-errors.log`, the truth layer would go dark, and AD-13 would hide it.
  - The relative `src/hooks/main.ts` path also doesn't resolve from the project cwd.
- **Fix:**
  - At install or first run, record the absolute path of a qualifying Node binary in `${CLAUDE_PLUGIN_DATA}/node-path`.
  - `bin/factory` and `hooks.json` both invoke `"${CLAUDE_PLUGIN_ROOT}/bin/factory-node" "${CLAUDE_PLUGIN_ROOT}/src/hooks/main.ts" <event>`, using that pinned path.
  - On a version mismatch, the CLI exits with a new `NODE_VERSION` error, and the dashboard shows a hook-health banner.

### Medium

**M1. The decision-consumption check makes the fold non-deterministic, and inbox adoption breaks the single-writer rule**

- **Location:** AD-6 (consumption), AD-9 ("the CLI adopts them"), the Design Paradigm ("facts, written only by hooks"), AD-18.
- **Issue:**
  - "Consuming one unconsumed matching fact" depends on which fact the fold sees first. Facts arrive across several files, and no rule fixes that order.
  - Adopting inbox facts means either the CLI writes facts, which contradicts the single-writer rule, or the reducer reads `inbox/`, which is outside the run directory and so missing from recordings.
  - `/factory resume` in a fresh or cleared session (an AD-6 decision) depends on exactly this path.
- **Fix:**
  - The decision command stores `data.prompt_fact_id`. The reducer validates that the ID exists, matches and is unused. No search happens at fold time.
  - On bind, the CLI writes `session_bound` with the adopted inbox lines embedded verbatim, keeping their original IDs, and then deletes the inbox file. The reducer treats embedded lines as facts.

**M2. The merge order across streams is undefined**

- **Location:** AD-1, AD-4.
- **Issue:** The fold consumes `commands.jsonl` plus N fact files. Claimed, verified and unverified states (AD-7) and replay depend on interleaving, and the spine says nothing about it. The CLI, dashboard and replay may each merge differently. That violates AD-1's "same function".
- **Fix:**
  - The commands are the backbone, in file order.
  - Facts are merged by `(ts, id)`.
  - `core` exposes one `loadRun(streams) → orderedEvents` used by every adapter.

**M3. There is no Open Questions section, so spike-dependent and unverified items are scattered**

- **Location:** whole spine, AD-9, AD-12, AD-15, AD-22, Deferred (sandbox).
- **Issue:**
  - `CLAUDE_CODE_SESSION_ID` is undocumented (the memlog says so; the spine does not).
  - The `agent_type` naming spike's fallback (`factory-` prefix plus spawn record) would change AD-5's `actor` and AD-7's matching, and the spine never says how.
  - The Stop hook spike has no fallback in the spec, and the spine doesn't add one.
  - Honoring `stop_hook_active` means a second stop attempt always succeeds, which weakens CAP-14 "cannot end".
  - AD-12 doesn't classify the `wait` step kind (background agents running) as working or parked. A blocked Stop during `wait` busy-loops the conductor.
- **Fix:**
  - Add an Open Questions section listing each spike, its effect on which AD, and the fallback.
  - Decide that `wait` counts as stoppable.
  - Decide the Stop fallback: a `SessionStart` (source `clear` / `resume`) hook injects `additionalContext` telling the conductor to run `factory next` for the bound run.
  - Accept the `stop_hook_active` leak explicitly.

**M4. Agent writes to `~/.factory/.../artifacts/` will hit permission prompts**

- **Location:** AD-10, AD-11 (one output file at `output_path`), build-order spike "Sandboxed writes to ~/.factory" (covers the CLI and hooks only).
- **Issue:** Subagents running in the worktree must `Write` to a directory outside it. Without an allow rule or an added directory, every agent output triggers a prompt or a denial. That breaks the unattended build loop, and the spike criterion doesn't test it.
- **Fix:** Choose one approach, and extend the spike to agents' Write tool:
  - The install step adds `~/.factory` to `permissions.additionalDirectories` and allow rules.
  - Or agents emit output through `factory write-output <step_id>` on stdin, which keeps the "agents only call the CLI" invariant tighter.

**M5. Slice git discipline is undefined while review is pipelined**

- **Location:** AD-3 (parallel steps), AD-22 (shared dev server), CAP-8.
- **Issue:**
  - While reviewers judge slice N, the builder edits N+1 in the same worktree. The spine doesn't say which diff reviewer-code reviews, or whether UI reviewers see half-built N+1 through the hot-reloading shared dev server.
  - `factory done` doesn't report the builder's `agent_id`, so the `resume` step (SendMessage) has no target.
  - After `/clear`, the old agent may be unreachable, and no fallback is named.
- **Fix:**
  - The builder commits at `STATUS: DONE`. The review brief carries `base_sha..head_sha`.
  - UI-tagged reviews of N don't overlap UI-affecting builds of N+1, or reviewers run against a `git worktree` snapshot of `head_sha` (state the choice).
  - `factory done <step_id> --agent-id <id>` records the agent ID.
  - A `resume` step degrades to `spawn` with a rework brief if SendMessage fails.

**M6. The budget-clock origin is wrong, and time-based transitions have no trigger**

- **Location:** AD-17.
- **Issue:**
  - The clock is measured "from `intake_confirmed.ts`". The exercise clock is already running during INTAKE, so the cut fires late by the length of intake. CAP-11 is "2:00 limit reaching 1:20".
  - The cut, the time-box escalation and the overdue states are computed only when someone calls `factory next`. During a long builder step nobody calls it, so the cut is raised late.
- **Fix:**
  - Measure from `run_started.ts`, or from a human-entered `clock_started_at` in the intake front matter.
  - Add a synchronous `PostToolUse` hook (factory sessions only) or the `wait` step's polling cadence. Either one injects "threshold crossed — run `factory next`" as `additionalContext`.

**M7. Gate and escalation card content is not single-sourced**

- **Location:** AD-3 (`card?` field), AD-16.
- **Issue:** The UX requires the chat message to carry the same title, type tag, reason label and command as the dashboard card. The conductor prints `card` from `next`, and the dashboard renders from its projection. Nothing says these come from one function.
- **Fix:** Have `src/core/cards.ts` derive the card from state. `next` embeds it, and the dashboard projection uses the same function. Define the `card` shape `{type, title, reason_label?, reason?, command}`.

**M8. Three spec capabilities and constraints are only partly covered**

- **Location:** AD-11, the Capability → Architecture Map rows for CAP-6, CAP-9 and CAP-10, and the Constraints.
- **Issue:**
  - **CAP-9.** UI-reviewer findings must cite an observed page state, but the finding schema has only `category`, `failure_scenario` and `location`.
  - **CAP-6.** Invent mode asks at most one question, but a subagent can't ask the human. The mechanism is undefined: an `ask_human` step? Does it count against CAP-10's interrupt list?
  - **Constraint.** "New dependencies in brownfield require the human" relies only on the builder's prompt.
- **Fix:**
  - Add `observed: {url, state, screenshot_path?}` to the finding schema, required for `reviewer-ux`, `reviewer-a11y` and `reviewer-ui`, with screenshots written under `artifacts/`.
  - The designer returns `STATUS: DONE` with a `question:` block. `next` raises it as `ask_human`, typed `design_choice`, answered by `/factory choose <a|b>`. Record it as a spec item for CAP-10.
  - The slice-close CLI check diffs the manifests and lockfiles in brownfield. Any change raises `escalation_raised` (`New dependency:`) automatically.

**M9. Plugin updates and event-schema versioning are not covered**

- **Location:** AD-5 (`v:1`), AD-16 (singleton dashboard), Conventions (Paths: `CLAUDE_PLUGIN_ROOT` moves on update).
- **Issue:**
  - A plugin update moves `CLAUDE_PLUGIN_ROOT`. The detached dashboard then keeps running old code, from a directory that may have been deleted, against logs with new kinds.
  - Nothing says what the reducer does with an unknown `v` or `kind`. Old recordings are meant to double as fixtures.
- **Fix:**
  - `dashboard.pid` becomes `{pid, plugin_version, root}`. `factory start` / `resume` restart the dashboard on a version mismatch.
  - The reducer rejects unknown `v`, and ignores unknown kinds while flagging them in the projection.
  - Kinds are only added, never renamed.

**M10. SIGNAL LOST sits outside the fold and uses the wrong liveness source**

- **Location:** AD-21 (`SIGNAL_LOST_MISSED`), AD-1 ("identical board" on rebuild), AD-18.
- **Issue:**
  - `claude agents --json` prints active sessions (interactive and background), not in-session subagents. A hung builder under a live conductor session never reads as "no live agent".
  - The poll result isn't in any stream, so the rebuilt or replayed board can't reproduce SIGNAL LOST. That contradicts AD-1 unless this is stated as an exception.
- **Fix:**
  - Reword the rule as session liveness: no session from `sessions/` bound to the run appears in `claude agents --json`.
  - Declare SIGNAL LOST a live-only overlay that is excluded from AD-1's equality and from replay. Replay derives it from heartbeats alone.
  - Let a hung subagent be caught by the slice time box.

**M11. AD-8 checks clash with the Bash timeout and with the Gate 1 evidence**

- **Location:** AD-8, AD-7 (Gate 1 row), AD-3 (`run_check` kind).
- **Issue:**
  - AD-8 runs tests "when a slice closes and when a gate is evaluated", inline in a CLI call. The conductor's Bash call times out after 2 minutes by default (10 at most). It then retries mid-check, and the retry gets `LOCKED` or a duplicate check.
  - AD-7's Gate 1 evidence is a spec lint (spec exists, every AC has a check), not a test run. AD-8 says the CLI runs test or health at gates.
  - `run_check` exists as a step kind but isn't tied to AD-8.
  - The spec's "fits one screen" has no check.
- **Fix:**
  - Checks run only as `run_check` steps (`factory check <step_id>`), and the brief carries a `timeout_ms`. The conductor runs the step with a matching Bash timeout or in the background.
  - Gate 1 evidence is `spec_lint` (AC checks plus `SPEC_MAX_LINES` in AD-21). Gate 2 evidence is `plan_lint`. Test and health checks run at slice close and at WRAP.

**M12. The Deferred "shared dependency store" rationale is false**

- **Location:** Deferred, first bullet.
- **Issue:**
  - "Only the scaffolder touches installs" is not true. Builders add packages in greenfield runs, and in brownfield ones after an escalation ruling. Parallel runs (epic 5) share the store.
  - If the scaffolder picks a pnpm store and the builder runs `npm install`, they diverge.
- **Fix:** Keep the store choice deferred, but add a Rule: every install or add goes through the run contract's `install` and `add` commands, which the builder brief carries. Then nothing else can diverge.

### Low

**L1. The Structural Seed hook command can't resolve from the project directory**

- **Location:** Structural Seed (`hooks/hooks.json # every event → node src/hooks/main.ts <event>`).
- **Issue:** The relative path won't resolve from the project cwd.
- **Fix:** Use `${CLAUDE_PLUGIN_ROOT}`-qualified commands (see H10). Scope matchers so that sync hooks only spawn Node when needed, for example a `factory` matcher on `UserPromptExpansion`.

**L2. Mermaid labels will render garbled, and some transitions don't use AD-5 event names**

- **Location:** both seed diagrams.
- **Issue:**
  - Labels like `runs/<id>/artifacts/` and `~/.factory/<hash>/worktrees/<id>` contain `<id>` / `<hash>`, which the sanitizer treats as HTML tags and strips.
  - Several transitions are unlabeled (`gate_raised`, `stage_completed`).
  - `rule (human)` is not an AD-5 kind; it should be `escalation_ruled`.
- **Fix:** Use `&lt;id&gt;` or `{id}`, and label every transition with an AD-5 kind.

**L3. The dashboard's watch glob is malformed, and the cache has no stated writer**

- **Location:** AD-16 (`~/.factory/*/runs/**.jsonl`).
- **Issue:** The glob is malformed and ambiguous. SQLite's writer and contents aren't stated.
- **Fix:** Use `~/.factory/*/runs/*/{commands.jsonl,facts/*.jsonl}`. Add "Only the dashboard server writes `cache.sqlite`, and the schema lives in `src/dashboard/server`."

**L4. `run_parked` / `run_resumed` duplicate the derived parked state**

- **Location:** AD-5.
- **Issue:** These events duplicate the parked state derived in AD-12 and the state diagram.
- **Fix:** See H3. Keep `run_resumed` only as the session-rebind marker.

**L5. Model routing omits four agents**

- **Location:** Consistency Conventions (Models).
- **Issue:** `recon`, `framer`, `scaffolder` and `slicer` have no model.
- **Fix:** Assign them, using frontmatter aliases (`opus` / `sonnet`) rather than dated IDs.

**L6. Three ADs contain rationale or history rather than decisions**

- **Location:** AD-11, AD-15, Deferred.
- **Issue:**
  - AD-11's last bullet ("came from an autonomous approver agent and is dropped") is history.
  - AD-15 says "(as in the spec)".
  - Deferred items carry justifications.
- **Fix:**
  - Reduce AD-11's last bullet to "Only these two first-line forms exist".
  - Inline the fallback in AD-15.
  - In Deferred, keep the one-line "why it can't diverge" and nothing more.

**L7. The import-specifier convention is missing**

- **Location:** Consistency Conventions (Files and modules).
- **Issue:** Native type stripping requires explicit `.ts` import specifiers. That needs `allowImportingTsExtensions` / `rewriteRelativeImportExtensions` with `noEmit` in tsconfig.
- **Fix:** Add "relative imports end in `.ts`; tsconfig `noEmit`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `verbatimModuleSyntax`".

**L8. AD-19's zero-dependency list omits the dashboard server**

- **Location:** AD-19.
- **Issue:** `src/dashboard/server` is not in the list.
- **Fix:** Add it, so that only `src/dashboard/web` has npm deps, and those at build time only.

**L9. The CLI surface and error codes are not consolidated**

- **Location:** Consistency Conventions (CLI I/O), AD-3, AD-16, AD-18, AD-19.
- **Issue:**
  - Subcommands are scattered across ADs: `start`, `next`, `done`, `decide`, `resume`, `record`, `dashboard` and `check`.
  - The error-code list lacks codes for bad arguments, an unknown run or step, and a failed check.
- **Fix:** Add a subcommand table. Add `BAD_ARGS`, `NOT_FOUND`, `CHECK_FAILED` and `NODE_VERSION`.

**L10. The localhost dashboard is open to DNS rebinding**

- **Location:** AD-16.
- **Issue:** A GET-only server bound to localhost can still be read by a page in the browser through DNS rebinding. Run data includes command lines.
- **Fix:** Reject requests whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>`.

**L11. Housekeeping and the merge executor are unspecified**

- **Location:** Operational envelope, AD-13, AD-15, AD-7 (Merged), CAP-13.
- **Issue:**
  - No rule says when `WorktreeRemove` or branch deletion runs, or how long `runs/`, recordings and `hook-errors.log` are kept.
  - The spine doesn't say who executes the merge or PR, conductor or CLI. The PR path needs `gh` and network, which contradicts "local-only".
- **Fix:**
  - The worktree is removed after `merged` and `factory record`. Branches are kept, and nothing else is pruned automatically.
  - `factory merge` executes the merge after `merge_approved`.
  - Note in the operational envelope that the PR path needs `gh` and network.

## Coverage notes

- **Build order vs spine.** No AD or map says which ADs each increment must satisfy, or which stubs it may use. Increment 1 precedes the "truth layer" increment 2. AD-6 still forces increment 1 to ship the `UserPromptExpansion` hook, the reducer and `commands.jsonl`, and the spine should say so. Add an "Increment column" to the Capability → Architecture Map, for example: 1 = core + store + cli + the UserPromptExpansion/Stop hooks; 2 = fact hooks + dashboard; and so on.
- **Spec capabilities.** CAP-1 through CAP-16 all have a home. The partial coverage is listed in H2 (CAP-2 and CAP-7 rosters), H3 (CAP-1 rerun, CAP-8 concurrency), H4 (CAP-2 intake confirmation), H6 (CAP-16 multi-run), H8 (CAP-3 greenfield), M5 (CAP-8) and M8 (CAP-6, CAP-9).
- **Dimensions.** These are decided: paradigm, structure, data, identity, concurrency, security (partly), testing, stack and UX hand-offs. Operations is the silent one: process lifecycle (H7), crash recovery (H9), runtime pinning (H10), upgrades (M9) and housekeeping (L11).
