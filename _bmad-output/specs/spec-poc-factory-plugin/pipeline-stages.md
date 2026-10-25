# Pipeline Stages

One pipeline; forks only at orientation. Flow diagram: `architecture-diagrams.md`.

| Stage | Where | Does | Emits | Gate |
|---|---|---|---|---|
| INTAKE | main checkout, read-only | Conversational brainstorm with human; records an optional time limit (and when its clock started, if earlier than the run) and slice time box (default 30 min); may mark task UI-free; may override reviewer tags | Intake notes | Human confirms (`/factory approve intake`) |
| FRAME (greenfield) | main checkout | Chooses stack + UI kit | Context artifact (incl. UI surface yes/no) | — |
| RECON (brownfield) | main checkout, read-only | Maps unseen repo; map reused by later runs on the same base commit | Context artifact (same shape as FRAME) | — |
| SCAFFOLD | worktree (outside repo) | Greenfield: create project + own test runner. Brownfield: the factory runs the contract's install; verify install/start/tests. On a failed check: one repair round (contract commands only), then the SCAFFOLD-failure ask | Run contract | SCAFFOLD-failure ask |
| SPEC ∥ DESIGN | worktree | Spec (one screen) and `design.md` in parallel; designer runs if app has a UI surface and task not marked UI-free | `spec.md`, `design.md` | **Gate 1** (spec + design) |
| SLICE PLAN | worktree | Slices with reviewer tags and independent/dependent mark | Slice plan | **Gate 2** |
| BUILD LOOP | worktree | Per slice: builder ⇄ reviewers; pipelined for independent slices, serial for dependent | Code + verdict files | Escalations only |
| WRAP | worktree → target | Summary, conflict resolution, re-verify, transcript snapshot+redact | PR or local merge | **Human merge OK** |

Greenfield: `/factory` in a non-git directory runs `git init` plus an empty initial commit before the run is claimed; project files are created only in the worktree.

Factory artifacts (intake notes, context artifact, run contract, `spec.md`, `design.md`, slice plan, agent outputs) live under `~/.factory/<repo-hash>/runs/<run-id>/`, never in the worktree. Nothing factory-owned is merged into the target.

Budget clock: only when INTAKE set a time limit; without one there is no clock, no cut, and the board shows elapsed time. It runs from run start (or the earlier start entered at INTAKE with the limit) and never pauses. At stated limit − 40 min (2:00 → 1:20; 1:30 → 0:50) the conductor proposes cutting remaining slices — a live human gate, never pre-planned away.

## Run contract

Fields: install, start, URL/port, test command, health check, stateful services (DBs, queues; shared vs per-run). One dev server per run, started at SCAFFOLD, shared by all reviewers (separate browser sessions per reviewer).

## Spec format

- Fits one screen; detail lives in acceptance criteria.
- Every acceptance criterion carries a command or page check.
- `Assumptions` section — human checks it for hidden product decisions at gate 1.

## design.md format

DESIGN.md-format token frontmatter + sections: Components to use / States / Accessibility floor.

- **Inherit** (brownfield): extract from repo, no questions.
- **Invent** (greenfield): UI-system defaults; at most one question (2 options + default); everything else marked `[ASSUMPTION]`.
- Sonnet; ~10 min.
- Later UI slice tags never re-trigger the designer; reviewer-ui folds into reviewer-ux instead.

## Agent protocol

- One output file per agent; the first line is the verdict, in one of two forms:
  - reviewers: `VERDICT: APPROVE|FINDINGS|ESCALATE`
  - all other agents: `STATUS: DONE|ESCALATE`
- Builder is resumed across rounds via SendMessage (keeps context).
- Pipelined findings: findings on slice N arriving while the builder works N+1 are queued, fixed once N+1's implementation is done and before N+1 goes to review; only the raising reviewer re-checks.
- Pipelining applies to diff reviewers; running-app reviewers run only while no builder is active.
- Model routing: Opus for spec + builder; Sonnet for reviewers + designer.

## Conductor commands

Every human decision is a typed `/factory` subcommand; free-form chat is for INTAKE and non-decisions only.

- `/factory [task]` — start (e.g. `/factory add about button`).
- `/factory` — resume from disk (must survive a panicked `/clear`): inside a worktree → its bound run; main checkout with one live run → that run; several → list (stage, slice, last activity) and ask; none → start INTAKE and ask for the task.
- `/factory resume <run-id>` — explicit resume.
- `/factory approve intake|gate1|gate2`, `/factory merge` — pass a planned gate.
- `/factory cut <slices>`, `/factory keep` — answer the budget-clock cut.
- `/factory rule <escalation> <choice>`, `/factory choose a|b` — answer an escalation or the designer's question.
- `/factory rework <target> <note>` — send a gate or slice back with a note.
- `/factory rerun <stage>` — re-run RECON, FRAME, SPEC, DESIGN, or SLICE PLAN while the run awaits the human.
- `/factory abandon [run-id]` — end a run and release its claims.

## Worktrees

- Created at SCAFFOLD by the factory CLI (`git worktree add`) at `~/.factory/<repo-hash>/worktrees/<run-id>`; the conductor enters it by path. No plugin `WorktreeCreate`/`WorktreeRemove` hook — it would take over every session's worktrees.
- The CLI copies the gitignored files the run contract names (e.g. `.env`).
- Fallback (if entering the outside path cannot be pre-allowed): native `.claude/worktrees/factory-<run-id>` + entry in untracked `.git/info/exclude`. Git's `.git/worktrees` bookkeeping is accepted.
- Per run: id, branch `factory/<run-id>`, port in run contract; atomic `mkdir` claim on the run id.
- Greenfield worktree requires the initial commit made at start.
- Run contract lists a shared mutable DB → a second concurrent run in that repo is refused (one run per repo) until the first completes or is abandoned. Multi-run replay recordings use a repo without one.
