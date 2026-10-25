# Epic 5 Context: Parallel Runs, Multi-Run Recording, and the Greenfield Path

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic finishes the factory's scope. First, several runs can work in one repo at once without interfering, and a multi-run session can be recorded and replayed as concurrent lanes (CAP-12, CAP-16). Parallel runs are never shown live in an interview, only by replaying a real recording, so the recording matters as much as the concurrency. Second, `/factory` works in an empty directory, through FRAME, invent-mode design and a scaffolded project with its own test runner (CAP-3, CAP-4, CAP-6). The factory then covers both interview formats: "add a feature to an unseen codebase" and "start from scratch".

## Stories

- Story 5.1: Parallel runs and multi-run recording
- Story 5.2: Greenfield path

## Requirements & Constraints

- **Concurrent runs.** Two runs in one repo finish on distinct branches and ports. Neither interferes with the other, and the main checkout's `git status` gains no entries.
- **Run ID claims.** A second claim on the same run id fails.
- **Shared database.** A second concurrent run is refused when the run contract lists a shared mutable service. The rule is one run per repo until the first run completes or is abandoned. Per-run database provisioning is a non-goal, so multi-run recordings must use a repo without a shared DB.
- **Bare `/factory`** resolves in this order:
  1. inside a worktree, that worktree's run;
  2. in the main checkout with exactly one live run, that run;
  3. with several live runs, the resume list, and it asks which run to resume (resume selection is a declared human ask);
  4. with no live run, it starts INTAKE.
- **Multi-run replay** shows concurrent lanes. Replayed transcripts contain no secrets. Recordings from increments 1–4 must still load, and existing folded snapshots stay byte-identical.
- **Greenfield parity.** Every stage after orientation runs unchanged on brownfield and greenfield runs. Greenfield SCAFFOLD succeeds only when the project, its own test runner and an initial commit exist and the health check passes.
- **Invent-mode design** asks at most one question: two options plus a default. Everything else is marked `[ASSUMPTION]`, and the default UI system is shadcn-class. When FRAME picks a UI kit, reviewer-ui uses it as a reference.
- **Recording sessions.** Record only in interactive sessions, never with `claude -p`.

## Technical Decisions

- **AD-15: worktrees and the exclusive claim.**
  - The CLI creates each worktree at `<repo>/.claude/worktrees/factory-<run-id>` on branch `factory/<run-id>` and ensures `.claude/worktrees/` is listed in `.git/info/exclude`.
  - Only `paths.ts` resolves this location.
  - If the run contract lists a shared service, the run claims `<repo-hash>/exclusive/` by `mkdir` at SCAFFOLD.
  - `factory start` refuses with `REFUSED_EXCLUSIVE` while a non-terminal run holds that claim.
- **AD-20: machine resources are claimed atomically.**
  - The CLI claims the dev-server port with `mkdir ~/.factory/ports/<n>` from `PORT_RANGE` before SCAFFOLD and passes the port in the brief. The run contract's `port` must echo it.
  - The CLI alone owns the dev server: `factory devserver up` uses `PORT=<n>` and keeps the pid and log in `runs/<run-id>/devserver.*`.
  - The dev server is killed before its port is released.
  - Ports and `exclusive/` are released only when the fold is terminal (`run_completed` or `run_abandoned`).
  - Agents never start or kill servers. An exhausted range returns `LOCKED`.
- **AD-25: session binding.**
  - `session_bound` gives a run exactly one conductor, and `~/.factory/sessions/<session>.json {repo_hash, run_id}` is the only way hooks resolve their run.
  - A mutating call from a session that isn't the holder fails with `NOT_HOLDER`. `start`, `resume` and `decide` are exempt.
  - Bare `/factory` refuses with `CLAIM_TAKEN` while the holder is live. Liveness comes from `claude agents --json`, where an idle session counts as live.
  - A typed `/factory resume` always rebinds.
- **AD-9: identity and greenfield init.**
  - `run-id` is `<slug>-<4 base32>`, claimed by an atomic `mkdir runs/<run-id>`.
  - `repo-hash` is derived from `--git-common-dir`, so all worktrees of a repo share one hash.
  - In a non-git directory, `factory start` first runs `git init` and an empty commit `factory: init`, before the run is claimed. Project files are created only in the worktree.
- **AD-27: artifact schemas.**
  - FRAME (agent `framer`, sonnet) emits the same context schema as RECON: `origin: greenfield`, `ui_surface`, and `ui_reference?` (the chosen UI kit).
  - The designer runs iff `ui_surface` is true and `ui_free` is false. Invent mode is reachable only when the context has `origin: greenfield`.
  - The roster stays derived only in `core/roster.ts`.
  - Every install goes through the run contract's `install` and `add` commands.
  - The run contract's `services[{name, shared}]` drives the exclusive claim.
- **AD-18: multi-run recordings.**
  - `factory record <name> --runs a,b` writes all runs under one `recordings/<name>/`, with a `runs[]` manifest.
  - Replay folds them with the same reducer and the same playback clock.
  - Redaction stays single-sourced in `core/redact.ts` (AD-14).
- **Constraints carried from earlier work.**
  - Increment 3 skips the new-dependency check (`git.deps`) at slice close in greenfield, because the factory owns the project. Brownfield new dependencies still escalate.
  - Increment 3's designer `question` block, `design_choice` card and `/factory choose a|b` already exist. Increment 5 only makes them reachable through FRAME.
  - `/factory rerun FRAME` is part of the decision grammar.

## UX & Interaction Patterns

- **Second run refused.** The message prints in chat, and no swimlane appears: `Run refused — <run-id> is live in this repo and its run contract lists a shared database. One run per repo.`
- **Claim taken.** `Run <run-id> is already claimed by another session.`
- **Resume list.** One row per live run, in Swimlane header vocabulary: `run id · title · stage · slice · last activity`, for example `… · BUILD · S3 · 2m ago`.
- **Lanes.**
  - One lane per run, stacked with the most recently started on top. Column counts sum across all lanes.
  - The Needs You column's gold tint runs through every lane as one queue.
- **Origin tag.** Every Swimlane header shows `brownfield` or `greenfield`. The orientation stage card reads `RECON` or `FRAME` and carries no sprite, because the conductor owns that stage.
- **Replay Flow 2.**
  - Two concurrent lanes, for example one in BUILD and one waiting at Gate 1.
  - `next decision` jumps across both runs' gold pips. Timeline pip labels name the run, for example `Gate 1 · <run-id>`.
  - The Evidence drawer works on either lane.

## Cross-Story Dependencies

- **5-1 builds on earlier work.**
  - Increment 1 already handles single-run worktrees, port claims, session binding and `factory record`.
  - Epic 4 already handles single-run replay. Its ordering and pip labels were written so they don't assume a single run.
- **5-2 reuses the designer, roster and full loop from epic 3.** The only new parts are greenfield init, FRAME, greenfield SCAFFOLD and invent-mode reachability.
- **Open items to settle in 5-1. These come from deferred work.**
  - **Run-lock crash windows.** Two lock breakers can both rename a dead owner's lock and steal a newly acquired one, and a lock left with no `owner.json` never goes stale. Real contention arrives with parallel runs.
  - **Shared-session redaction.** `record --runs a,b` with one session bound to both runs must redact that transcript with the union of both runs' redact values. Confirm the patch, and add a test for `--runs`, which is untested.
  - **Regression fixtures.** No real interactive recording exists yet. The multi-run recording should be made interactively on a repo with no shared DB and added as a regression fixture.
