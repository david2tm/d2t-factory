# Epic 3 Context: Full Loop — Intake, Designer, Slices, Reviewers, Budget Clock

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Turn increment 1's walking skeleton into the full pipeline (CAP-2, 6, 7, 8, 9, 10, 11). The skeleton has a stub intake, a single-slice plan and only reviewer-code. This epic adds:

- a conversational INTAKE that records the exercise limit, the slice time box, UI-free and reviewer overrides;
- a budget clock that never pauses and raises a live cut gate;
- a designer that runs in parallel with SPEC;
- a multi-slice plan with tags and dependency marks;
- a roster derived in core, covering all five reviewers under the charter;
- a multi-slice build loop with pipelined diff reviews, retrigger rounds, rework and rerun.

Through all of it, only the closed list of human asks reaches d2t. This is what lets the timed dry run reach a human-approved merge within 2:00 with every interrupt explainable.

## Stories

- Story 3.1: Full intake, budget clock, and cut gate
- Story 3.2: Designer in parallel with spec
- Story 3.3: Full slice plan and reviewer roster
- Story 3.4: Full build loop and escalations

## Requirements & Constraints

- **Intake.**
  - No spec file exists until the human confirms intake.
  - Intake records the stated time limit, plus the exercise's start time if it began before the run.
  - The slice time box defaults to 30 min.
  - The human may mark the task UI-free.
  - A reviewer override must show up in every affected slice's roster.
- **Budget clock.**
  - It runs from run start, or from the earlier exercise start, and never pauses.
  - At limit − 40 min with unbuilt slices, the conductor proposes a cut as a live human gate (2:00 → 1:20, 1:30 → 0:50). It is never planned away in advance.
  - The human's choice is recorded.
- **Designer.**
  - It runs iff the app has a UI surface and intake did not mark the task UI-free. Later UI slice tags never re-trigger it.
  - It writes one `design.md`: DESIGN.md-style token front matter plus the sections Components to use, States and Accessibility floor.
  - **Inherit mode (brownfield)** asks zero questions.
  - **Invent mode** asks at most one question (two options plus a default) and marks everything else `[ASSUMPTION]`.
  - It takes about 10 min on Sonnet. Its output is approved together with the spec at gate 1.
- **Slices.** Every slice carries roster tags and an independent/dependent mark. BUILD needs a recorded gate-2 pass.
- **Reviewer charter.**
  - Report a finding only with a concrete failure scenario, in one of four categories: Bug, Spec miss, Security (with a real exploit path), or Breakage (brownfield only: failing tests or a convention a maintainer would reject).
  - There are no nits and no notes tier. Every finding is must-fix.
  - Correctness disputes are settled by tests, not argument.
- **Roster.**
  - **reviewer-code** always runs, on the diff.
  - **reviewer-security** runs on slices tagged input, auth, secrets or external, on the diff.
  - **reviewer-ux** and **reviewer-a11y** run on UI-tagged slices and judge the running app. a11y reports objective failures only.
  - **reviewer-ui** runs on UI-tagged slices only when a reference exists: `design.md`, the repo's component library, or the FRAME UI kit. It compares the running app with that reference. With no reference, its broken-rendering checks fold into reviewer-ux.
  - UI-facing findings must cite an observed page state.
- **Build loop.**
  - A seeded bug must be reported with a failure scenario and fixed before the slice closes.
  - No slice may exceed 2 retrigger rounds or its time box without escalating.
  - Findings on slice N that arrive mid-build of N+1 are fixed before N+1 goes to review.
- **The closed ask list.** Only these reach the human:
  - **Planned gates:** intake confirm, gate 1, gate 2, cut, merge OK.
  - **Escalation conditions:**
    1. Scope change, or spec ambiguity that forks the code.
    2. Irreversible or outward action. A new dependency counts only in brownfield.
    3. Non-convergence, or a slice over its time box.
    4. Builder/reviewer taste disagreement.
  - **Declared asks:** SCAFFOLD failure, the designer's one question, resume selection.

  In the dry run, every human prompt must map to exactly one of these. Lost liveness is shown on the dashboard only.

## Technical Decisions

- **AD-27 (schemas and roster in core).**
  - `core/artifacts.ts` owns the front matter that agents write and only the CLI parses:
    - **intake:** `limit_min`, `slice_timebox_min?`, `ui_free`, `reviewer_overrides`, `started?`
    - **context:** `ui_surface`, `ui_reference?`
    - **run contract:** `e2e?`
    - **spec:** `acceptance[{id: AC-n, check}]`, `assumptions[]`
    - **slice-plan:** `slices[{id: S<n>, title, acs[], tags[ui|input|auth|secrets|external], depends_on[]}]`
  - `core/roster.ts` alone derives the roster from slice tags, intake overrides and `ui_reference`. The slicer only tags.
  - Every install goes through the run contract's `install` and `add` commands.
- **AD-17 (time).**
  - **Flags.** `now` sets flags only: `overdue`, `at_risk`, `timebox_exceeded`.
  - **Commands.** Time-driven transitions exist only as commands the CLI appends: `ask_raised` for a cut, or for an `Over time box` escalation.
  - **Slice time box.** Wall time since `slice_started`, minus any time with an open escalation on that slice.
  - **Waking the conductor.** On `wait`, the conductor runs `factory next --wait <ms>` as a background Bash. `retry_after_ms` is never later than the next deadline (cut, time box or claim overdue).
    - Spike 05 passed: the CUT card was on screen 2.8 s after the deadline.
    - The wake-up arrives as a `UserPromptSubmit` with a `<task-notification>` body. It must never be treated as a `/factory` prompt.
- **AD-21 constants** live only in `core/config.ts`: `CUT_LEAD_MS` 40 min, `SLICE_TIMEBOX_DEFAULT_MS` 30 min, `MAX_RETRIGGER_ROUNDS` 2, `SPEC_MAX_LINES` 40.
  - **Non-convergence** means the round count reaches 2 while a `FINDINGS` verdict is still outstanding.
  - A **round** is one builder `resume` issued in response to `FINDINGS`.
- **AD-30 (slice lifecycle).**
  - **Slice machine:** BACKLOG → BUILDING → IN_REVIEW → FINDINGS_QUEUED / ESCALATED / CLOSED / CUT. `rework_requested` takes a slice from CLOSED back to BUILDING.
  - **Commits.** At each builder `done`, the CLI commits `factory: <slice> <title> (<step_id>)` and records the `sha`. The builder never commits.
  - **Closing.** A slice closes only on a clean `check_ran` at a sha that contains its last builder commit, taken while no builder step is claimed.
  - **Who reviews when.**
    - Running-app reviewers are issued only while no builder step is claimed.
    - Pipelining applies only to diff reviewers on independent slices. They review `base..sha`.
    - Findings on S*n* queue until S*n+1*'s implementation is done. Only the raising reviewer re-checks.
  - **Cut.** Any `cut_decided`, cut or keep, suppresses a re-raise of the cut for the rest of the run.
- **AD-11 (agent output).**
  - **Line 1.** Reviewers write `VERDICT: APPROVE|FINDINGS|ESCALATE`. All other agents write `STATUS: DONE|ESCALATE`.
  - **Line 2 after `ESCALATE`.** `<Label>: <line>`, where the label is one of `Scope change | Spec ambiguity | Irreversible action | New dependency | Non-convergence | Over time box | Taste disagreement | Scaffold failed`.
  - **Findings.** Each goes in a fenced `finding` block with `category`, `location` and `failure_scenario`, in that order. ux, a11y and ui add `observed: <url> <state> [<screenshot>]`.
  - **Designer question.** A fenced `question` block with options `a` and `b` and a default.
  - **Parse failure.** The CLI returns `MISSING_EVIDENCE` and reissues the step as a `resume` of the same agent.
- **AD-34 (cards).**
  - `core/cards.ts` derives `{type, title, reason_label?, reason?, commands[]}`.
  - Types: `intake`, `gate_1`, `gate_2`, `cut`, `merge`, `escalation` (with `condition` 1–4), `design_choice`, `scaffold_failure`, `resume_select`.
  - `commands` holds only the decisions that are legal for that card. The intake card shows the four intake fields.
  - `ask_raised.data.card` records the card. The conductor prints it verbatim as the last lines of the turn. INTAKE turns, the designer's question and every escalation are `ask_human` steps, so the Stop hook allows the turn to end.
- **AD-22 (browser driver).** Reviewers use the run contract's `e2e` when one is named. Otherwise they use one isolated browser session per reviewer (`<run-id>-<role>`) against the run's single dev server.
  - **Still open.** `npx agent-browser` cannot run under the Bash sandbox. The fallback adopted is Playwright MCP, but its isolation check has not been run. Decide this, and verify isolation, before or at story 3.3.
- **AD-33 (rework and rerun).**
  - `rework_requested` and `stage_rerun_requested` carry `data.voids`: every later dependent gate pass, `step_verified` and `slice_closed`. Projections show voided events as superseded.
  - A slice rework does not count as a round.
  - RECON, FRAME, SPEC, DESIGN and SLICE_PLAN can be rerun, and only from a parked state.
- **Decision grammar** (`core/decision.ts`): `cut S<n>[,S<n>…]`, `keep`, `rule E<n> <choice…>`, `choose a|b`, `rework gate1|gate2|S<n> <note…>`, `rerun <stage>`. Escalations are numbered `E1…` per run.
- **Supporting rules.**
  - **AD-3.** At most one open step per agent role, so SPEC ∥ DESIGN works because they are different roles.
  - **AD-7.** Gate 1 also requires a verified `design` step whenever the designer is required.
  - **AD-8.** At slice close, `git.deps` diffs manifests and lockfiles. Any change raises a `New dependency:` escalation, in brownfield only.
  - **AD-20.** The CLI alone owns the dev server and health-checks it before any running-app step. Agents never start or kill servers.
  - **AD-23.** Slice list, roster, dependencies, the Assumptions count, escalations (`E<n>`, label, line), findings and verdicts are embedded in command `data`.
  - **AD-32.** Event changes stay additive within `v:1`.
- **Models.** `opus` for spec-writer, slicer and builder. `sonnet` for the designer and all reviewers. The builder is resumed across rounds via SendMessage.

## UX & Interaction Patterns

- **Same card everywhere.** Chat and board show the same card title, type tag, reason label and commands. Escalation reasons start with the bold label, then one line, for example `Over time box: S4 at 34 / 30 min.` Use short character names: `Brix vs Quill`.
- **Budget clock** (swimlane header):
  - counts down from the limit;
  - fixes its cut marker at limit − 40m;
  - past 0:00, shows `+m:ss over` in amber, which is reserved for budget pressure.
- **Cut card.** It reads `Cut point reached — N slices unbuilt. Cut S5, S6?`. Remaining Backlog cards show `AT RISK · cut candidate`.
  - Cut slices go to Done with a `CUT` tag, the seal `cut · Master d2t` and no Claim chip.
  - Kept slices lose AT RISK.
- **SPEC and DESIGN** run in parallel In Progress, with Sela Venn on DESIGN. The DESIGN card is omitted when there is no UI or the task is UI-free. Both merge into one gate card, `Gate 1 — Spec + Design ready`, showing `N assumptions to check`.
- **Slice cards.**
  - **Path.** Backlog → In Progress (with the Time box meter) → In Review (Verdict list, one row per rostered reviewer, each with its own Claim chip) → Done.
  - **Findings.** They send the slice back to In Progress with the meta `round n/2`. A pipelined slice waits in In Review marked `findings queued`.
  - **Escalation.** The slice card itself moves to Needs You tagged `ESCALATION`. The ruling seals it `escalation ruled · Master d2t`.
- **Rework.**
  - **Gate rework.** The gate card leaves, the stage card(s) return to In Progress with the seal `rework · Master d2t`, and the gate diamond reverts to hollow.
  - **Slice rework.** The slice returns with its full roster, and `round n/2` does not advance.
- **SCAFFOLD failure** shows on the board as `ESCALATION` / `Scaffold failed:`. Its card type is `scaffold_failure`.

## Cross-Story Dependencies

- **3.1 feeds later stories.**
  - `ui_free` gates the designer in 3.2.
  - `reviewer_overrides` feed the roster in 3.3.
  - `slice_timebox_min` drives the time box in 3.4.
  - The cut gate acts on the unbuilt slices that 3.3 and 3.4 produce.
- **3.2 feeds 3.3.** `design.md` is reviewer-ui's reference, alongside `ui_reference`.
- **3.3 feeds 3.4.** Its tags, roster and browser driver feed 3.4's build loop.
- **3.4 must settle these deferred items:**
  - How an open step on a cut, voided or rerun-cleared slice gets closed. Otherwise the one-open-step-per-role rule blocks that role; this may need a `step_cancelled` command.
  - Capping agent reissues, and raising a `Non-convergence` card instead of looping forever.
  - A fallback when a SendMessage `resume` of a finished builder fails.
- **Before 3.3,** the open browser-driver decision (Playwright MCP isolation) must be resolved.
- **Builds on epics 1 and 2.** The new events must render on epic 2's board through command data only, never through artifacts.
- **Recordings.** Recordings from this epic become epic 4's regression fixtures. Record only in interactive sessions, never with `claude -p`.
- **Epic 5** exercises invent mode and FRAME's UI kit end to end on greenfield.
