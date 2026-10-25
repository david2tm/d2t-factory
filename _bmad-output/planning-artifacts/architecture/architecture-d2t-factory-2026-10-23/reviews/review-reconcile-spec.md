---
review: reconcile-spec
target: ../ARCHITECTURE-SPINE.md
against: ../../../../specs/spec-poc-factory-plugin/ (SPEC.md, pipeline-stages.md, review-policy.md, truth-layer.md, build-order.md, prior-art.md, architecture-diagrams.md, .memlog.md)
date: 2026-10-23
intentional-deviations-accepted: [AD-11 verdict vocabulary narrowed]
counts: {critical: 2, high: 13, medium: 15, low: 6}
---

# Spine ⇄ Spec Reconciliation

Gap test used: a spec item counts as a finding only if the spine **contradicts** it, or if two independently built units (conductor skill, CLI, reducer, hooks, agents, dashboard, replay) could diverge on it because the spine gives no rule. Restating the spec is not required.

Each finding gives a severity, the spec source, what is missing or contradicted, and a concrete spine edit.

---

## Critical

### C1 — INTAKE (and every other conversational `ask_human`) is a working state, so the Stop hook blocks it

- **Spec source:** CAP-2 (INTAKE is a "conversational brainstorm with the human"); CAP-6 (invent mode asks up to one question); pipeline-stages.md Conductor commands (with several live runs, "list … and ask"); CAP-14.
- **Problem:** AD-12 plus the note under the state diagram say "`PARKED_*` states are the only non-terminal states in which the conductor may stop". `INTAKE` is not a `PARKED_*` state, and neither is `SPEC_DESIGN` (where the designer's question lands). A conversation means the conductor ends its turn so the human can reply, but every such turn end gets blocked. The only way out is the `stop_hook_active` pass-through, and leaning on that makes the CAP-14 guarantee meaningless. So the conductor skill and the Stop hook will conflict.
- **Fix:** Change AD-12 so it is defined by open steps rather than by state names. Suggested text: "*Parked* = the run's open-step set from `factory next` is non-empty and every step in it is `ask_human` (INTAKE dialogue, designer question, gate, escalation, cut, merge, scaffold failure), or every step is `wait` on a live background agent. Terminal = `DONE` or abandoned. All other states are *working*." Then define `stop_hook_active` exactly: "when it is true and the run is still working, block again with the same reason. Loop safety comes from a per-turn block counter in the session file, max N." Update the state-diagram note to match.

### C2 — Greenfield has no identity before `git init`, and the SCAFFOLD ordering (init → initial commit → worktree) has no rule

- **Spec source:** CAP-4 greenfield ("project, test runner, and initial commit exist"); pipeline-stages.md SCAFFOLD ("Greenfield: `git init` + initial commit"), Worktrees ("Greenfield worktree requires the initial commit made in SCAFFOLD"); build-order.md spike ("incl. on a single-commit repo"); `.memlog` CAP-4 (git init/commit).
- **Problem:** AD-9 defines `repo-hash` as `sha256(realpath(git rev-parse --git-common-dir))`. In a greenfield directory with no repo yet, that command fails. But `run-id` is claimed under `<repo-hash>/runs/` at `run_started`, during INTAKE, which comes before SCAFFOLD. The spine also never says where `enter_worktree` sits relative to `git init`, or where the init happens (in the main directory, so it creates `.git` in the target). AD-8's SCAFFOLD evidence only covers brownfield.
- **Fix:**
  1. Add to AD-9: "Greenfield, no repo: `factory start` runs `git init` and an empty initial commit (`--allow-empty`, message `factory: init`) in cwd *before* computing `repo-hash` and claiming the run. These are the only writes the factory makes to a greenfield main checkout before merge." The alternative is a provisional `~/.factory/_nogit/<sha(realpath cwd)>/` keyed run that gets re-keyed at init. Pick one.
  2. Add to AD-15: "`enter_worktree` is the first step of SCAFFOLD for both modes. Greenfield project files are created inside the worktree."
  3. Add a row to AD-7 / AD-8: "SCAFFOLD done (greenfield) = `check_ran` health + test command exit 0, **and** `git rev-list --count HEAD ≥ 1` on the run branch."

---

## High

### H1 — Intake confirmation and its parameters have no human-provenance path

- **Spec source:** CAP-2 ("the human enters the exercise's stated time limit … may set the slice time box … UI-free … override reviewer selection"; "No spec file exists until the human confirms intake"); `.memlog` direction ("time ceiling = whatever limit the exercise states … no default").
- **Problem:** The state diagram labels `INTAKE → ORIENT: intake_confirmed (human)`. But AD-6's closed decision set has no command for confirming intake, and AD-7 has no row for it. The fields the reducer depends on (limit, box, UI-free flag, reviewer override) appear in no event payload. As written, the conductor would assert both the confirmation and the time limit from free-form chat, which is exactly the LLM-asserted decision that AD-6 exists to prevent. The budget clock (AD-17) would then rest on a number the LLM supplied.
- **Fix:**
  - Add to AD-6's closed set: `/factory go --limit <h:mm> [--box <min>] [--ui-free] [--reviewers +sec,-ux…]`, or `approve intake` with those flags.
  - Add an AD-7 row: "Intake confirmed | `human_prompt` (AD-6) whose args carry `limit`".
  - Add to AD-5: "`intake_confirmed.data = {limit_ms, slice_box_ms (default SLICE_TIMEBOX_DEFAULT_MS), ui_free:boolean, reviewer_override:{add:[],remove:[]}}`, all parsed from the consumed prompt fact's args and never from conductor text. `limit_ms` is required, with no default."

### H2 — The budget clock is anchored at `intake_confirmed.ts`, which leaves INTAKE time out of the exercise budget

- **Spec source:** CAP-11 ("stated time limit − 40 min"; "a run with a 2:00 limit reaching 1:20"); build-order.md timing ("intake + recon + … ≈ T+35–40", so T includes intake).
- **Problem:** AD-17 measures the clock from `intake_confirmed.ts`. The exercise clock starts no later than `/factory [task]`, and the brainstorm can take 5–15 minutes. Every minute of INTAKE makes the cut fire that much later, which puts the stated limit at risk. This contradicts the spec's arithmetic.
- **Fix:** In AD-17, replace "measured from `intake_confirmed.ts`" with "measured from `run_started.ts`, or from the human-supplied `--started <hh:mm>` on the intake command if the exercise clock began earlier".

### H3 — The cut gate re-raises in a loop after `keep`, and a partial cut contradicts the diagram

- **Spec source:** CAP-11 ("raises the cut proposal; the human's choice is recorded"); AD-6 `cut <slices>` / `keep`.
- **Problem:** AD-17 says `next` raises the cut "when the threshold is crossed and unbuilt slices remain". After `keep`, both conditions are still true, so `next` raises it again immediately. The diagram also sends `cut_decided (cut) → WRAP`, but `cut <slices>` can be partial, leaving kept slices unbuilt. It is also unstated whether a slice already in progress counts as "unbuilt".
- **Fix:** Add to AD-17: "The cut is raised **at most once per run**: no further `cut_proposed` after any `cut_decided`. 'Unbuilt' = slices not yet `slice_started`. The in-flight slice always continues." Change the diagram to `PARKED_CUT → BUILD: cut_decided (keep or partial)` and `PARKED_CUT → WRAP: cut_decided (all remaining cut, nothing in flight)`.

### H4 — Pipelined findings queueing and the per-slice lifecycle have no home

- **Spec source:** CAP-8 ("independent slices are reviewed while the next one builds, dependent slices run serially"; "findings on slice N arriving mid-build of N+1 are fixed before N+1 goes to review"); pipeline-stages.md Agent protocol ("queued, fixed once N+1's implementation is done and before N+1 goes to review; only the raising reviewer re-checks"); `.memlog` Q4.
- **Problem:** `BUILD` is a single state. Nothing in the spine defines:
  - the slice sub-states;
  - when slice N+1 may start (only if N+1 is independent);
  - the queue-don't-preempt rule;
  - the order fix(N) → review(N+1);
  - the rule that only the raising reviewer re-checks;
  - whether there is one builder instance per run or per slice.

  The reducer author and the conductor and builder-brief authors will each pick something different, and the dashboard's `findings queued` card (UX) has no state behind it.
- **Fix:** Add "AD-23 — Slice lifecycle (reducer-owned)":
  - The sub-states are `queued → building → in_review → (findings_queued) → fixing → rechecking → closed | escalated`.
  - One builder agent per run, resumed across slices and rounds.
  - Slice N+1 may enter `building` while N is `in_review` only if N+1 is marked independent. Otherwise it waits for N to reach `closed`.
  - Findings on N that arrive while the builder is `building` N+1 put N in `findings_queued`. `next` issues the fix for N only after the builder reports N+1's implementation done, and issues N+1's review only after N's fix is reported.
  - A re-check spawns only the reviewers whose last verdict on N was `FINDINGS`.
  - A slice closes when every roster reviewer's latest verdict is `APPROVE` and `check_ran` passes (AD-8).

### H5 — No designer trigger rule, so the superseded "skip when no UI slices" behavior can creep back in

- **Spec source:** CAP-6 ("runs whenever the app has a UI surface unless INTAKE marked the task UI-free"; "later UI slice tags never re-trigger it"; inherit asks zero questions, invent at most one); `.memlog` Q3 (supersedes "skip when no UI slices").
- **Problem:** CAP-6 maps to AD-3, AD-10 and AD-11, and none of them states the trigger. Without the rule, a reducer could reasonably spawn the designer when a UI-tagged slice shows up with no `design.md`, which is exactly the behavior the spec forbids. The invent-mode question has no route either. A subagent cannot ask the human directly, so it needs an `ask_human` step.
- **Fix:** Add to AD-3, or a new AD: "The designer `spawn` is issued in SPEC_DESIGN iff `context.ui_surface == true && !intake.ui_free`. Mode = `inherit` for brownfield, `invent` for greenfield, and it is passed in the brief. The designer is never issued in any other stage. Invent mode may raise at most one question by finishing with `STATUS: ESCALATE` + `Design choice:` and two options plus a default. `next` turns that into one `ask_human`, typed as a gate-1 sub-question (not one of the four escalations), and resumes the designer with the answer. A second question is rejected by the reducer."

### H6 — Roster computation (tags × INTAKE override × reference) has no single home

- **Spec source:** CAP-2 ("a reviewer override is reflected in every affected slice's roster"); CAP-7; review-policy.md Roster table (reviewer-ui only when a reference exists: `design.md`, a repo component library, or a FRAME UI kit; otherwise it folds into reviewer-ux).
- **Problem:** `next` has to choose which reviewer agents to spawn, the dashboard shows the roster, and Gate 2 checks "roster tags". The spine has no module that derives the effective roster, no closed tag vocabulary, and no definition of "reference exists". The CLI could spawn the slicer's tags while the board shows the override, and the reviewer-ux brief might never pick up the folded-in reviewer-ui checks.
- **Fix:** Add `src/core/roster.ts` to AD-7 or a new AD.
  - Closed tags: `ui | input | auth | secrets | external`.
  - Roster: `effective_roster(slice) = {code} ∪ {security if tags∩{input,auth,secrets,external}} ∪ {ux, a11y if ui} ∪ {ui if ui && reference} ⊕ intake.reviewer_override`.
  - `reference = design.md written || context.component_library || context.ui_kit`.
  - When `ui && !reference`, the reviewer-ux brief has the `broken_rendering` section appended.
  - CLI, dashboard and Gate 2 all call this one function.

### H7 — The schemas of artifacts that `core` must parse are undefined

- **Spec source:** CAP-3 (context artifact "including whether the app has a UI surface"); CAP-4 / pipeline-stages.md Run contract (install, start, URL/port, test, health, stateful services shared vs per-run); CAP-5 ("every acceptance criterion has an executable check"; "renders in one screen"; Assumptions section); CAP-7 (roster tags + dependency mark).
- **Problem:** The CLI runs the run-contract commands (AD-8), reads the port (AD-20), reads the shared-DB flag (AD-15) and the e2e tooling (AD-22), and checks ACs and slice marks for the gates (AD-7). These files are written by LLM agents (scaffolder, framer/recon, spec-writer, slicer), but AD-11 only fixes the first line. Two independently built units, the agent prompt and the core parser, will diverge.
- **Fix:** Add "AD-24 — Parsed artifacts". Each parsed artifact carries YAML frontmatter, validated by `src/core/artifacts.ts`. The parser fails with `MISSING_EVIDENCE`:
  - **`context.md`:** `{mode: brownfield|greenfield, ui_surface: bool, component_library?: string, ui_kit?: string, e2e_tool?: string}`.
  - **`run-contract.md`:** `{install, start, url, port, test, health, stateful_services:[{name, kind, shared: bool}]}`.
  - **`spec.md`:** `acceptance:[{id, check:{type: cmd|page, value}}]`, a required `## Assumptions` heading, and body ≤ `SPEC_MAX_LINES` (add this constant to AD-21).
  - **`slice-plan.md`:** `slices:[{id: S1…, tags:[…], depends_on:[ids] | independent: true}]`.

### H8 — Fact-to-step correlation (`corr`) has no derivation rule, and the `agent_type` spike fallback has no home

- **Spec source:** truth-layer.md Facts ("Subagent start/stop with `agent_type`"); build-order.md spike "Plugin `agent_type` naming", fallback "Match `factory-` name prefix + conductor's spawn record in registry"; CAP-15 ("claim with no matching hook fact displays as unverified").
- **Problem:** AD-4 says facts attach to commands "by `corr`", but hook payloads carry `session_id`, `agent_id` and `agent_type`, never a `step_id`. When two steps of the same `agent_type` run at once (reviewer-code on N and N+1 under pipelining), AD-7's "matching `agent_type`" can't tell them apart. The hooks author and the reducer author will each invent a join. The spike fallback ("conductor's spawn record") would make LLM self-report the evidence, which contradicts AD-7, and the spine never says how that fallback works.
- **Fix:** Add to AD-4 / AD-7:
  - "Hooks never set `corr`. They write `corr: null` plus `agent_id`."
  - "The reducer binds `agent_id → step_id` from the `PreToolUse(Agent|Task)` fact, whose `tool_input.prompt` must contain the line `FACTORY_STEP: <step_id>` (the conductor copies it verbatim from the step brief), paired with the next `subagent_started` in the same session that has a matching `agent_type`."
  - "Output facts bind by `output_path`, which is unique per step."
  - "If the `agent_type` spike fails, match the `d2t-factory:` / `factory-` prefix plus the `FACTORY_STEP` marker. The binding is still hook-observed and never `step_reported`."

### H9 — Resume resolution after `/clear` is unspecified: new session, cwd → run, "live", one conductor per run

- **Spec source:** CAP-1 success (after `/clear`, resume at the same stage and slice; inside a worktree, that worktree's run; in the main checkout with several live runs, list and ask); pipeline-stages.md Conductor commands (main checkout with one live run → that run); `.memlog` Q7b.
- **Problem:** `/clear` starts a new `session_id`, so the AD-9 binding no longer applies. The spine has no rule mapping cwd to a run: from `<repo-hash>/worktrees/<run-id>`, from the fallback `.claude/worktrees/factory-<run-id>`, or from the main checkout via the repo-hash run list. It does not define "live" or map bare `/factory` onto `resume`, and the resume list fields (stage, slice, last activity) have no home. Nothing stops two sessions driving one run: `CLAIM_TAKEN` exists but has no rule. The UX expects "already claimed by another session".
- **Fix:** Add "Resume resolution" to AD-9:
  1. `factory resume [run-id]`: with an explicit id, use it.
  2. Otherwise, if cwd is under a factory worktree path (either placement, via `paths.ts`), use that path's run-id.
  3. Otherwise, take live runs for the repo-hash, where live = not `DONE` / `run_abandoned`. With one, use it. With several, return an `ask_human` step listing `{run_id, title, stage, slice, last_event_ts}`. With none, start INTAKE.
  4. Bare `/factory` = `resume` with no id.
  5. Binding a session to a run rebinds atomically and revokes the prior session's binding. A second *concurrently live* conductor (heartbeat within `SIGNAL_LOST` window) gets `CLAIM_TAKEN`.

### H10 — Crash without SessionEnd: no abandon path, and liveness sits outside the fold

- **Spec source:** truth-layer.md ("Liveness: heartbeat + `claude agents --json` (crashes emit no SessionEnd)"; failure mode "crash without SessionEnd"); CAP-12 (one run per repo with a shared DB).
- **Problem:** `run_abandoned` is a kind, but no AD-6 command produces it. AD-20 reclaims ports only for runs that are "SIGNAL LOST and abandoned". SIGNAL LOST is computed from the dashboard's `claude agents --json` poll, which is not an event, so it is not in the AD-1 fold. The CLI can't compute it, a deleted cache won't reproduce it, and replay can't reproduce it. A crashed run therefore holds its port, the one-run-per-repo slot and a resume-list entry forever.
- **Fix:**
  - Add `/factory abandon <run-id>` to AD-6 (it produces `run_abandoned`).
  - Have the CLI (not only the dashboard) record `liveness_probed {live_agents:n}` as a command whenever it runs, so SIGNAL LOST = fold(events, now) and stays in AD-1.
  - In AD-20: "A port or shared-DB slot held by a SIGNAL LOST run is offered to the human as `abandon` in the refusal message, and is never silently reclaimed."

### H11 — The brownfield "no tracked file changes" check looks at the wrong tree and has no baseline

- **Spec source:** CAP-4 brownfield ("no tracked file in the target repo changes"); pipeline-stages.md ("Brownfield: install nothing"); CAP-12 ("no new entry in `git status` of the main checkout"); INTAKE and RECON "read-only".
- **Problem:** AD-8 records "a clean `git status --porcelain` of the main checkout" at SCAFFOLD. With work in the worktree, the main checkout is clean anyway, while the real risk (`npm install` rewriting `package-lock.json`, or config edits in the *worktree*, which then get merged) goes unchecked. "Clean" also fails falsely when d2t's main checkout was already dirty. The read-only rule for INTAKE and ORIENT is never checked.
- **Fix:** Rewrite AD-8's SCAFFOLD bullet:
  - "At `run_started`, the CLI snapshots the main checkout's `git status --porcelain=v2` as the baseline."
  - "At the end of ORIENT, at SCAFFOLD done, and before `merge`, the main checkout must equal the baseline."
  - "At brownfield SCAFFOLD done, the worktree must show `git diff --quiet HEAD` (no tracked changes) and no new untracked files outside gitignored paths."
  - "A failure → `PARKED_SCAFFOLD`."

### H12 — Dev server lifecycle has no owner

- **Spec source:** pipeline-stages.md Run contract ("One dev server per run, started at SCAFFOLD, shared by all reviewers"); CAP-9 (UI reviewers judge the running app); CAP-12 (distinct ports).
- **Problem:** AD-20 claims a port, but nothing says who starts the process: the scaffolder subagent's background Bash, the conductor, or the CLI. Nor is it said where the PID lives, how it survives `/clear` or a subagent ending (background jobs die with their owner), who health-checks it before UI reviewers are spawned, when it is stopped, or what happens when a brownfield app hardcodes its port. The scaffolder, the reviewer briefs and the CLI will each assume someone else owns it.
- **Fix:** Add to AD-20:
  - "The CLI owns the dev server. `factory devserver up` spawns `run_contract.start` detached with `PORT=<claimed>` in the worktree, writes `runs/<id>/devserver.pid`, and records `check_ran` on `health`."
  - "`next` issues a `run_check devserver` before any UI-reviewer spawn and restarts the server if it is down. It is stopped on `run_completed` or `run_abandoned`."
  - "If the app ignores `PORT`, the run contract's `port` field is authoritative, and a second live run on the same port is refused like the shared-DB case."

### H13 — Writes to `~/.factory` from agents and Bash need permissions, and the sandbox spike's "install step" has no home

- **Spec source:** build-order.md spike "Sandboxed writes to `~/.factory`", fallback "Install step adds `~/.factory` to user-level sandbox write allowlist"; truth-layer.md failure mode "sandbox blocking worktree→main writes"; CAP-10 (no unplanned human interruptions).
- **Problem:** AD-10 puts every agent `output_path` under `~/.factory/<hash>/runs/<id>/artifacts/`, which is outside the session's working directory. Subagent `Write` calls there will trigger permission prompts (or denials). That creates unplanned human interrupts and violates CAP-10, and a denial means the verdict is missing. The spine defers "allowlist mechanics", but the agreed fallback needs an install step, and the spine has no install or setup command at all. User-level plugin install runs no scripts.
- **Fix:**
  - Add `factory setup` (idempotent) to the CLI. It merges `~/.factory` into the user's `permissions.additionalDirectories`, `Write`/`Edit` allow rules for `~/.factory/**`, and the sandbox write allowlist in `~/.claude/settings.json`.
  - `factory start` refuses with `SETUP_REQUIRED` until setup has run, and the code is added to the CLI I/O error codes.
  - Keep the spike only for whether the hooks and CLI need it.

---

## Medium

### M1 — Rework and rerun transitions are too narrow, and invalidation is undefined

- **Spec source:** CAP-1 ("re-runs any stage, and sends work back with `/factory rework <note>`"); pipeline-stages.md ("Per-stage skills — re-runnable individually").
- **Problem:** The diagram only allows `rework_requested` from `PARKED_GATE1` and `PARKED_GATE2`. Rework of a slice during BUILD, at an escalation, or at `PARKED_MERGE` has no transition, and `stage_rerun_requested` has none at all. Nothing says what a rerun of SPEC invalidates, for example whether gate 1 and the slice plan must be redone.
- **Fix:** Add transitions:
  - `PARKED_MERGE → BUILD: rework_requested` (the note targets the named slice or opens a new fix step).
  - `PARKED_ESCALATION → BUILD: rework_requested`.
  - `any non-terminal → <stage>: stage_rerun_requested`.

  Add the rule "A rerun of stage X voids every later gate pass and artifact (spec → gate1, slice plan, gate2), and those gates must be re-raised. Closed slices stay closed unless the rerun stage is SLICE_PLAN."

### M2 — Non-convergence and time-box escalations: who raises them, how a finding is identified, what a round is

- **Spec source:** review-policy.md condition 3 ("same finding bounced twice, or slice over its time box"); CAP-8 ("no slice exceeds 2 retrigger rounds or its time box without escalating").
- **Problem:** AD-17 computes the limits, but only the cut is said to be raised by `next`. "Same finding bounced twice" needs a finding identity across rounds, and none is defined. "Round" and the start of the time box are undefined, and so is whether parked time counts against the box.
- **Fix:** In AD-17:
  - "`next` itself emits `escalation_raised {condition:3, label:'Non-convergence:'|'Over time box:'}` when the round count exceeds `MAX_RETRIGGER_ROUNDS` or slice elapsed exceeds the box. Agents never raise condition 3."
  - "Round = one builder resume after a `FINDINGS` verdict."
  - "Box clock starts at `slice_started` and excludes time spent parked."
  - In AD-11, add `finding_id` (reviewer-assigned, stable across rounds) to the required finding fields.

### M3 — Brownfield new dependencies and irreversible actions rely on builder self-report

- **Spec source:** Constraint ("New dependencies in a brownfield repo require the human"); review-policy.md condition 2 (migrations, deleting code outside the slice, new dependencies only in brownfield); truth principle ("self-report never trusted alone").
- **Problem:** The spine has no detection. Only an agent's voluntary `ESCALATE` triggers condition 2, so a builder that silently adds a dependency passes the slice.
- **Fix:** Add to AD-8: "At slice close (brownfield), the CLI diffs dependency manifests and lockfiles, plus migration directories named in the context artifact, against the slice base. Any change without a matching `escalation_ruled` → `escalation_raised {condition:2, label:'New dependency:'|'Irreversible action:'}` instead of `slice_closed`. Greenfield skips the dependency part."

### M4 — The merge gate omits conflict re-verification and the mechanics of merging

- **Spec source:** CAP-13 ("a conflicted merge presents the resolutions plus passing tests and reviewer-code verdict before the OK request"; "PR or local").
- **Problem:** AD-7's Merged row only checks git state after the fact. Nothing requires tests and a reviewer-code `APPROVE` on the resolved tree before `PARKED_MERGE` is raised. The spine also leaves open who executes the merge (CLI or conductor), the target branch, and how PR vs local is chosen.
- **Fix:**
  - Add a row to AD-7: "Merge requested | if `git merge-tree` against the base shows conflicts: a resolution step, then `check_ran` test pass and a reviewer-code `APPROVE` on the resolution diff, all before `gate_raised(merge)`."
  - In AD-6, use `/factory merge [--pr|--local]`.
  - In AD-8: "The CLI performs the merge into the branch recorded at `run_started` (`base_ref`, `base_sha`), then records `merged`."

### M5 — Recording at WRAP misses the merge decision, and multi-run recording assembly is undefined

- **Spec source:** CAP-16 ("replay of a recorded run reproduces its lanes and human decisions"; "replay of a recorded multi-run session shows concurrent lanes"); build-order.md increment 5.
- **Problem:** AD-18 runs `factory record` during WRAP, which comes before `merge_approved`, `merged` and `run_completed`, so replay can't show the merge OK. `record <name>` takes "the run's" streams, so there is no rule for putting several runs into one recording.
- **Fix:** In AD-18:
  - "`factory record` runs after `run_completed` or `run_abandoned`, or again then if a WRAP snapshot was taken."
  - "`factory record <name> --runs <id,id…> | --session <window>` copies every listed run's streams into one recording. Replay folds each run independently on one shared playback clock."

### M6 — Gate 1 evidence omits `design.md`, the one-screen limit and the Assumptions section

- **Spec source:** CAP-5 ("spec renders in one screen"; Assumptions section); CAP-6 ("approved at gate 1"); pipeline-stages.md (Gate 1 = spec + design).
- **Problem:** AD-7's Gate 1 evidence is "spec exists and every acceptance criterion has a check". A gate pass with no `design.md` (when the designer ran), an over-long spec, or no Assumptions section would be accepted.
- **Fix:** Change AD-7's Gate 1 cell to: "`human_prompt` and `check_ran`: `spec.md` parses (H7) with every AC checked, has `## Assumptions`, and is ≤ `SPEC_MAX_LINES`; plus, iff the designer was issued, an `output_written` `design.md` with `STATUS: DONE`."

### M7 — AD-12 departs from CAP-14's literal criterion without declaring the deviation; `stop_hook_active` and `wait` semantics are open

- **Spec source:** CAP-14 success ("the conductor cannot end its session in a non-terminal state"); truth-layer.md; build-order.md (Stop-hook spike, no fallback).
- **Problem:** AD-12 lets the conductor stop in parked non-terminal states. That is necessary, because the Stop hook fires per turn, but it contradicts the spec's wording and, unlike AD-11, is not marked as an intentional deviation. The testable criterion therefore isn't restated, and the spike's pass test is ambiguous. `wait` steps on background agents are also unaddressed: blocking them forces a busy-loop on `next`.
- **Fix:**
  - Add a "Deviation" line to AD-12: "CAP-14's criterion is read as: the conductor cannot end a *turn* while its run is working. Session termination by the user is undetectable and out of scope. Spike pass = a blocked stop in a working state, and an allowed stop at a gate."
  - Cover `wait` in the C1 definition.

### M8 — The CAP-9 requirement that running-app findings cite an observed page state has no field; parser rejection handling is undefined

- **Spec source:** CAP-9 success ("ux/a11y/ui findings cite an observed page state"; zero findings outside the four categories); review-policy.md (Breakage is brownfield-only; Security needs a real exploit path; nits are "not generated or logged").
- **Problem:** AD-11 requires `category`, `failure_scenario` and `location` only. Nothing says what happens to a rejected block or file: re-spawn, escalate, or silently drop and log.
- **Fix:** In AD-11:
  - "Reviewers `ux|a11y|ui` must also give `observed_state` (URL + action sequence + what was seen)."
  - "`Breakage` is invalid in greenfield runs."
  - "If any block fails to parse, the whole output is rejected: `next` re-issues the reviewer step once with the parser error, and a second failure → `escalation_raised {condition:3}`. Rejected blocks are never logged as findings."

### M9 — The shared-DB "one run per repo" refusal has no timing and no atomic claim

- **Spec source:** CAP-12 ("a second concurrent run is refused when the run contract lists a shared mutable database"); pipeline-stages.md Worktrees ("one run per repo"); `.memlog` Q7a.
- **Problem:** AD-15 states the refusal, but the run contract only exists after SCAFFOLD. Two runs can both pass INTAKE, then both SCAFFOLD at once. "Concurrent" (whether parked runs count) is undefined.
- **Fix:** In AD-15:
  - "At SCAFFOLD done, a run whose contract lists a shared mutable service claims `<repo-hash>/exclusive/` by `mkdir`. It is released on `run_completed` or `run_abandoned`."
  - "`factory start` refuses when `exclusive/` is held by a live run (parked runs count as live), and a run reaching SCAFFOLD with a shared-DB contract refuses itself if another live run exists. Both refusals happen before any worktree code is written."

### M10 — Every human prompt must map to a planned gate or a named condition, but `card` is untyped

- **Spec source:** CAP-10 success ("every human prompt maps to a planned gate or one named escalation condition"); review-policy.md ("Planned gates … are not escalations").
- **Problem:** `ask_human` has an optional `card`, with no required classification. The conductor isn't barred from asking the human things outside `ask_human`. Scaffold failure (spine: `rule`) and the designer question are neither gates nor one of the four conditions, so the dry-run audit can't be computed.
- **Fix:** In AD-3:
  - "`ask_human` steps require `card.type ∈ {intake, gate_1, gate_2, cut, merge, escalation, resume_select, scaffold_failure, design_choice}`, and `card.condition ∈ {1..4}` when `type=escalation`."
  - "The conductor addresses the human only inside an `ask_human` step or INTAKE."
  - Record `scaffold_failure` and `design_choice` as declared, spec-traceable exceptions (CAP-4 page-on-failure, CAP-6 one question).

### M11 — The plugin `WorktreeCreate` hook silently disables `.worktreeinclude` for non-factory worktrees

- **Spec source:** Constraint ("Factory worktree hooks never alter non-factory worktree sessions"); pipeline-stages.md Worktrees ("`.worktreeinclude` is bypassed when the hook is set"; "non-factory requests fall through to default git behavior").
- **Problem:** AD-15 says other names get "the default `git worktree` placement". Once the hook is set, though, Claude Code's own default handling (including `.worktreeinclude` copying) no longer runs for *any* worktree. So the user-level plugin changes every non-factory worktree in every repo.
- **Fix:** In AD-15: "For non-`factory-*` names, the hook reproduces Claude Code's default placement **and** `.worktreeinclude` copying, byte for byte. `WorktreeRemove` likewise falls through to default removal. Both are covered by a test against a non-factory worktree."

### M12 — The build order conflicts with the spine's dependencies: increment 1 needs the truth layer and worktrees

- **Spec source:** build-order.md (increment 1 walking skeleton before increment 2 truth layer; worktrees in increment 5; replay in increment 4 on recordings from increments 1–3; spine frontmatter "epics = build-order increments 0–5").
- **Problem:** AD-6 and AD-7 make every gate and merge depend on `UserPromptExpansion` facts (truth layer), and AD-10 and AD-15 require a worktree from SCAFFOLD on. Increment 1 therefore can't be built as the spec orders it without either breaking the spine or pulling increments 2 and 5 forward. Recordings from increments 1–3 serve as fixtures (Conventions), but the kind list could change between increments.
- **Fix:** Add a "Build-order mapping" note:
  - "Increment 1 includes `core` reducer, CLI, the `UserPromptExpansion` + `Stop` hooks, and native `EnterWorktree` placement (the AD-15 fallback path)."
  - "Increment 2 adds the fact hooks, verification and the dashboard. Increment 5 swaps in the plugin `WorktreeCreate` placement."
  - In AD-5: "Kinds are append-only. They are never renamed or removed, and the reducer folds every `v` it has ever emitted."

### M13 — "Worktree holds product code only" is asserted but never checked

- **Spec source:** Constraint ("Nothing lands in the target project's working tree: factory tooling ships with the plugin").
- **Problem:** `agent-browser` screenshots and traces, builder scratch files, and `.claude/settings.local.json` written by permission "don't ask again" all land in the worktree's cwd and get merged. AD-10 has no check and names no output directory for browser artifacts.
- **Fix:**
  - In AD-22: "Browser artifacts go to `runs/<id>/artifacts/browser/<reviewer>/` (passed as a flag or cwd)."
  - In AD-8: "At slice close and before merge, the CLI fails with `MISSING_EVIDENCE` if the worktree has untracked or added files matching the factory denylist (`.claude/`, `*.png` outside source dirs, `agent-browser*`, `*.factory*`)."

### M14 — Commit and diff boundaries are undefined

- **Spec source:** review-policy.md (reviewer-code judges the "Diff"); CAP-8 (fix before closing; only the raising reviewer re-checks); CAP-13 (merge of branch `factory/<slug>`).
- **Problem:** Nothing says who commits (builder or CLI), when (per round or per slice), or what diff range a reviewer sees. Under pipelining, the diffs for N and N+1 interleave in one worktree.
- **Fix:** Add to AD-23 (H4):
  - "The builder never commits. The CLI commits the worktree at each `step_reported` of a builder step, as `S<n> r<round>`, and records the sha."
  - "A reviewer's brief carries `diff_range = <slice_base_sha>..<latest S<n> sha>`, restricted to the paths that slice touched."
  - "Fixes for N during N+1 are committed separately, so the ranges stay attributable."

### M15 — Resumed builder across `/clear`, and done-without-report steps

- **Spec source:** CAP-1 ("resumes at the same stage and slice without redoing completed work"); pipeline-stages.md ("Builder is resumed across rounds via SendMessage (keeps context)").
- **Problem:** After `/clear`, the previous session's subagent may not be reachable by SendMessage, and there's no rule for what a `resume` step falls back to. A step whose agent finished (`output_written` verified) before `/clear`, but which the conductor never `done`'d, is "re-issued unchanged", so the work gets redone.
- **Fix:** In AD-3:
  - "A step is complete when its AD-7 evidence is verified, whether or not `factory done` was called. `next` never re-issues a verified step."
  - "If a `resume` step's `agent_id` belongs to an unbound or ended session, `next` converts it to `spawn` with a brief containing the slice's prior outputs and open findings."

---

## Low

### L1 — `factory next` shares its name with the non-goal `/factory next`

- **Spec source:** Non-goals ("Backlog and `/factory next`").
- **Problem:** The internal CLI subcommand reads as the rejected ZazenCodes backlog command, which invites scope creep and reviewer confusion.
- **Fix:** Rename it to `factory step` (and `factory done` → `factory report`), or add to AD-3: "`factory next` is an internal CLI verb. `/factory next` is not a slash subcommand (non-goal), and the conductor must reject it."

### L2 — The terminal surface has no rule for "every surface foregrounds human decisions" or for tone

- **Spec source:** Constraint ("Every surface foregrounds human decisions over agent activity"); SPEC Why (interview showcase).
- **Problem:** The dashboard is covered through the UX, but the terminal (conductor messages, gate summaries) has no single-sourced text. The conductor may narrate agent activity.
- **Fix:** In AD-3: "`card` carries `{title, type, reason_label, reason, command}`. The conductor prints it verbatim as the first lines of any turn that ends on an `ask_human` step, and keeps agent-activity narration to at most one line per step. Voice follows EXPERIENCE.md Voice and Tone."

### L3 — Prior-art credit has no home

- **Spec source:** Constraint ("Prior art (ZazenCodes) is credited openly"); prior-art.md.
- **Fix:** Add to the Structural Seed: `README.md` (credits section, differentiators first) and `plugin.json.description` naming the ZazenCodes credit.

### L4 — Human attribution of decision events is not bound to the envelope

- **Spec source:** CAP-15 ("gates, escalations, and cuts appear as first-class human-attributed events").
- **Problem:** Decision commands are written by the CLI. AD-5 doesn't say whether their `actor` is `human` or `cli`, or that they reference the consumed prompt fact.
- **Fix:** In AD-6: "Decision commands carry `actor: human` and `data.prompt_fact_id` = the consumed `human_prompt.id`."

### L5 — Live facts are not redacted at write time

- **Spec source:** truth-layer.md failure mode ("transcript expiry and secrets"); CAP-16 (no secrets).
- **Problem:** AD-14 whitelists the fields facts may hold, but stored command lines can contain inline tokens (`curl -H "Authorization: …"`, `export KEY=…`), and the live dashboard shows them, possibly on an interview screen-share.
- **Fix:** In AD-14: "Hooks pass every string field through `redact.ts` before append. Recording re-applies it with the copied-file value set."

### L6 — Worktree, branch and fallback-MCP lifecycle details are unspecified

- **Spec source:** pipeline-stages.md Worktrees (`WorktreeRemove` hook); build-order.md browser spike (Playwright MCP fallback); Constraint (tooling ships with the plugin via MCP or npx).
- **Fix:**
  - In AD-15: "Factory worktrees are removed by the CLI after `run_completed` (after recording). The `factory/<slug>` branch is kept after a local merge and deleted after a PR merge."
  - In AD-22: "The Playwright MCP fallback is declared in the plugin's `.mcp.json`, never in the target repo."

---

## Observations outside the spec reconciliation (UX ⇄ spine, not counted)

- The UX puts `/factory resume <run-id>` on every Needs You card, including gates and escalations, while AD-6 requires typed `approve`, `rule`, `cut` or `merge`. Either the card command should become the decision command, or `resume` should re-present the card and the typed decision follow.
- The UX's run-id sample `r-7f3a` doesn't match AD-9's `<slug>-<base32×4>`.
- The UX's reason labels `Scaffold failed:`, and the proposed `Design choice:` (H5), should be in the closed list in `src/core/events.ts`, alongside the eight condition labels.

## Verified as landed (no finding)

- **Constraints and non-goals:** no Docker or required collector (AD-16, Operational envelope); dashboard read-only (AD-16, Deferred); no approver agent (AD-11); no notes or nit tier (AD-11 parser); `.factory/` never in the repo (AD-10, except the spec-accepted fallback); one pipeline with an orientation fork (diagram `ORIENT`); OTel optional (Deferred); every merge needs a human OK (AD-6, AD-7); truth never from self-report (AD-7, AD-8).
- **Identity and records:** atomic run-id claim (AD-9); per-writer JSONL with no concurrent appends (AD-4); unbound sessions dropped (AD-9, AD-13); hooks invisible to non-factory sessions apart from M11 (AD-13).
- **Spikes and agents:** env-var spike fallback adopted as primary (AD-9); RECON map reuse (AD-10); browser driver selection and spike (AD-22); model routing (Conventions).
- **Replay:** redaction scope includes copied gitignored files (AD-14).
