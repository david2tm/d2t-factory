---
id: SPEC-poc-factory-plugin
companions:
  - pipeline-stages.md
  - review-policy.md
  - truth-layer.md
  - build-order.md
  - prior-art.md
  - architecture-diagrams.md
  - ../../planning-artifacts/architecture/architecture-d2t-factory-2026-10-23/ARCHITECTURE-SPINE.md
  - ../../planning-artifacts/ux-designs/ux-d2t-factory-2026-10-23/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-d2t-factory-2026-10-23/EXPERIENCE.md
sources:
  - ../../forge/poc-factory-plugin/forged-idea.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# d2t-factory — POC Software Factory Plugin for Claude Code

## Why

Vision plus opportunity. d2t faces 1.5–2h interview exercises — add a feature to an unseen codebase, or start a project from scratch — and wants the same engine for fast POCs. The interview showcases d2t's mastery of *driving* Claude Code; the factory is the evidence. So the factory is a slimmed-down BMad (BMad builds it; it runs without BMad) whose every surface foregrounds the human's decisions — gates, escalations, cuts — over autonomous agent activity.

## Capabilities

- **CAP-1**
  - **intent:** Human starts a run with `/factory [task]`, resumes from disk with bare `/factory` or `/factory resume <run-id>`, re-runs a stage with `/factory rerun <stage>`, and sends work back with `/factory rework <target> <note>`.
  - **success:** After `/clear` mid-BUILD LOOP, `/factory` resumes at the same stage and slice without redoing completed work; inside a worktree it resumes that worktree's run; in the main checkout with several live runs it lists them and asks; with no live run it starts INTAKE.
- **CAP-2**
  - **intent:** Run opens with a conversational brainstorm (INTAKE) with the human before any spec is written; the human may set a time limit for the run and may set the slice time box, may mark the task UI-free, and may override reviewer selection.
  - **success:** No spec file exists until the human confirms intake on a card showing the agreed task and scope; slice box defaults to 30 min when not given; no time limit when none is given; a reviewer override is reflected in every affected slice's roster.
- **CAP-3**
  - **intent:** Factory orients itself — RECON maps an unseen repo (brownfield), FRAME chooses stack and UI kit (greenfield) — and both emit the same context artifact, including whether the app has a UI surface.
  - **success:** Every stage after orientation runs unchanged on a brownfield and a greenfield run; a RECON map is reusable by a second run on the same repo.
- **CAP-4**
  - **intent:** SCAFFOLD produces a run contract (install, start, URL/port, test command, health check, stateful services) and proves the project runs before any spec work.
  - **success:** Brownfield: no tracked file in the target repo changes and the health check passes, or — after at most one factory repair round that changes only the run contract's commands — the human is paged before any code is written. Greenfield: project, test runner, and initial commit exist and the health check passes.
- **CAP-5**
  - **intent:** Factory writes a spec that fits one screen, with every acceptance criterion carrying a command or page check and an Assumptions section the human checks for product decisions; human approves at gate 1.
  - **success:** Every acceptance criterion has an executable check; spec renders in one screen; BUILD cannot start without a recorded gate-1 pass.
- **CAP-6**
  - **intent:** Designer produces one `design.md` in parallel with the spec — inherited from the repo (brownfield) or invented from UI-system defaults (greenfield) — approved at gate 1; runs whenever the app has a UI surface unless INTAKE marked the task UI-free.
  - **success:** Inherit mode asks zero questions; invent mode asks at most one (two options + default); finishes in ~10 min; reviewer-ui uses it as reference whenever it ran; later UI slice tags never re-trigger it.
- **CAP-7**
  - **intent:** Factory splits the spec into slices, each tagged for its reviewer roster and marked independent of or dependent on earlier slices; human approves at gate 2.
  - **success:** Every slice carries roster tags per `review-policy.md` and a dependency mark; BUILD cannot start without a recorded gate-2 pass.
- **CAP-8**
  - **intent:** Per slice, a builder implements and reviewers review; findings send the slice back to the builder; independent slices are reviewed while the next one builds, dependent slices run serially.
  - **success:** A seeded bug is reported with a failure scenario and fixed before the slice closes; no slice exceeds 2 retrigger rounds or its time box without escalating; findings on slice N arriving mid-build of N+1 are fixed before N+1 goes to review.
- **CAP-9**
  - **intent:** Reviewers report only findings with a concrete failure scenario in the charter categories, and UI-facing reviewers judge the running app, not the diff.
  - **success:** Across a dry run, zero findings lack a failure scenario or fall outside Bug / Spec miss / Security / Breakage; ux/a11y/ui findings cite an observed page state.
- **CAP-10**
  - **intent:** Human is interrupted only by the asks listed in `review-policy.md` — planned gates, the four escalation conditions, SCAFFOLD failure, the designer's one question, and resume selection; everything else resolves among agents.
  - **success:** In a dry run, every human prompt maps to exactly one ask type in `review-policy.md`; lost liveness shows on the dashboard only, never as a chat prompt; no chat message asks the human to change sandbox or permission settings, and no command in a factory session runs outside the sandbox.
- **CAP-11**
  - **intent:** When INTAKE set a time limit, a budget clock, running from run start and never pausing, makes the conductor propose cutting remaining slices at the limit − 40 min, as a live human gate. Without a limit there is no budget clock and no cut gate; the board shows elapsed time.
  - **success:** A run with a 2:00 limit reaching 1:20 (or a 1:30 limit reaching 0:50) with unbuilt slices raises the cut proposal; the human's choice is recorded; a run with no time limit never raises a cut and its lane shows elapsed time.
- **CAP-12**
  - **intent:** Each run works in its own git worktree outside the repo's working tree, with its own id, branch (`factory/<run-id>`), and port, so multiple runs work in one repo without collision.
  - **success:** Two concurrent runs in one repo finish on distinct branches and ports with no cross-run interference and no new entry in `git status` of the main checkout; a second claim on the same run id fails; a second concurrent run is refused when the run contract lists a shared mutable database.
- **CAP-13**
  - **intent:** WRAP summarizes the run and merges (PR or local) only on explicit human OK; the factory resolves conflicts and re-verifies before asking.
  - **success:** No merge occurs without a recorded human OK; a conflicted merge presents the resolutions plus passing tests and reviewer-code verdict before the OK request.
- **CAP-14**
  - **intent:** Run state is recorded from hook-observed facts plus a state machine that owns stage semantics, so the record cannot be advanced by the LLM's say-so; human decisions count only when the human typed them as `/factory` commands.
  - **success:** An illegal transition is rejected; a gate pass without its evidence, or without a matching human-typed `/factory` command, is rejected; the conductor cannot end a turn while its run is working (it may stop when awaiting the human, waiting on background work, or terminal, or when the human rejected a tool call in that turn, read from the session's own transcript; a human interrupt ends the turn without Stop firing); a stop let through at the factory's block cap is recorded and shown on the dashboard; events from unregistered sessions are dropped.
- **CAP-15**
  - **intent:** A local web dashboard shows all runs as lanes — stage, current slice, reviewer verdicts, escalation queue — marking each item claimed vs verified and foregrounding human decisions, and lets the human read, read-only, each artifact a gate pins, and copy its path.
  - **success:** A claim whose hook facts never arrived displays as unverified; one waiting on a human decision or on checks displays as claimed with what it waits on; gates, escalations, and cuts appear as first-class human-attributed events; dashboard updates live without reload.
- **CAP-16**
  - **intent:** A recorded real session — single-run first, multi-run once parallel runs exist — can be replayed in the dashboard.
  - **success:** Replay of a recorded run reproduces its lanes and human decisions; replay of a recorded multi-run session shows concurrent lanes; replayed transcripts contain no secrets.

## Constraints

- Brief → working, human-approved result within the time limit when one is set, with explainable gates; time-box beats polish.
- Ships as a standalone Claude Code plugin installed user-level; target projects have no BMad.
- Nothing lands in the target project's working tree: factory tooling ships with the plugin (MCP/npx), the repo's own e2e tooling is preferred when present, factory state, run artifacts, and worktrees live under `~/.factory/<repo-hash>/`; the worktree holds product code only.
- Factory hooks never alter non-factory sessions.
- Factory sessions run every command inside the user's sandbox and never ask the human to loosen it; `factory setup` configures the sandbox the factory needs once per machine, except `allowLocalBinding`, which the human sets by hand. Tracked files the sandbox refuses to write (e.g. `.vscode/*`, `.mcp.json`) are read-only for the run and named on its cards. `factory start` refuses early, naming the sandbox, when the factory can't work under it.
- New dependencies in a brownfield repo require the human (escalation condition 2).
- Every merge requires explicit human OK.
- Dashboard truth never comes from LLM self-report; no Docker; minimal local process.
- Parallel runs are never executed live in an interview; parallelism is shown only via replay.
- Every surface foregrounds human decisions over agent activity.
- Prior art (ZazenCodes) is credited openly; positioning leads with differentiators (`prior-art.md`).

## Non-goals

- Coexisting or competing with BMad inside target projects.
- A notes or nitpick tier for findings — nits are not generated or logged.
- An approver agent that merges autonomously.
- Two separate greenfield/brownfield pipelines.
- A heavyweight BMad-style UX stage.
- Forking agents-observe, or OpenTelemetry as dashboard source (OTel at most an optional cost/token cross-check).
- `.factory/` state inside the repo.
- Dashboard as a cockpit — it is a read-only window until acting there beats the terminal.
- Backlog and `/factory next` — an interview run is one task.
- Per-run database provisioning for parallel runs.

## Success signal

- In a timed dry run on an unseen brownfield repo, `/factory <feature>` reaches a human-approved merge within the stated limit (2:00 for the dry run), with only the asks listed in `review-policy.md` reaching the human, and every stage and verdict on the dashboard shown as verified.
- d2t explains, unaided, why the dashboard is truthful, and replays a recorded session on demand.

## Assumptions

- Timings are tabletop estimates (per slice ~18–22 min clean, ~25–30 min with one rework; 3 slices ≈ T+110–130).
- Review pipelining saves less than the tabletop credited, since vertical slices are usually dependent — the dry run measures it.
- Many interview starter repos lack e2e tooling, so the plugin-shipped fallback is the common path.
- Greenfield invent mode defaults to a shadcn-class UI system.
- Every spike except Stop-hook blocking has an agreed fallback (`ARCHITECTURE-SPINE.md` Open Questions); CAP-14 depends on that one passing.
