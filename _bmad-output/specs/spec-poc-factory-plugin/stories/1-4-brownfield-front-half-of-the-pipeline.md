---
title: 'Brownfield front half of the pipeline'
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

**Problem:** After `/factory approve intake` the run sits in ORIENT forever: `due()` knows only INTAKE, no agents or briefs exist, nothing parses agent output or verifies a step from facts, there is no worktree, no run contract, no checks, and `decide` refuses gate 1 and gate 2 as "lands in 1-4". Orphaned claims after `/clear` also wedge the run (`CLAIM_TAKEN`).

**Approach:** Extend the CLI-driven loop through RECON → SCAFFOLD → SPEC + gate 1 → single-slice plan + gate 2, ending in BUILD. Add core output/artifact parsers, the AD-7 verifier, cards and a pure scheduler. The CLI adds briefs, the worktree, the port, `factory check`, a dev server for the health check, and gate evidence in `decide`. Add three agents and the real conductor skill.

## Boundaries & Constraints

**Always:** Node built-ins only; AD-2 layering (core pure, no I/O). Every new `events.ts` field is optional and additive, and the fixture snapshots stay byte-identical. Paths come only from `paths.ts`. All git and all checks run in the CLI, unlocked, then append under the lock with `basis_seq` (AD-8, AD-29). Approvals pin the `sha256` of each approved artifact (AD-10). Every projection that `next` or the cards need is embedded in command data at `done`/`check` time (AD-23), so the scheduler reads state only. `redact()` applies to every embedded projection. Nothing factory-owned is written into the target repo except the worktree under `.claude/worktrees/` and its `.git/info/exclude` line.

**Never:** No designer (3-2), slicer agent or roster (3-3), builder, reviewers, merge or record (1-5), budget clock (3-1), full intake (3-1), `rerun` or slice rework (3-x), `REFUSED_EXCLUSIVE` shared-service claim (5-1), `CLAIM_OVERDUE_MS` reissue, or heartbeat-loss orphan reissue. Stub intake stays 1-2's card with no artifact and still needs `/factory approve intake`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| RECON | ORIENT, no cache file for `base_sha` | `next` issues `spawn d2t-factory:recon` with a CLI-written brief; when verified, the CLI publishes `recon/<base_sha>.md` (temp + rename, only if absent), checks `git.baseline`, and appends `stage_completed{ORIENT}` | Cache hit → no spawn; `stage_completed` embeds the cached context and its sha256 |
| Agent done | `factory done <step>`; `out.md` line 1 `STATUS: DONE`, then `---` front matter per AD-27 schema | `step_reported{output}` embeds the parsed projection. `step_verified` lands when `done` or a later `next` sees `output_written` for that path plus `subagent_stopped` for the same `agent_id` | Parse failure → `MISSING_EVIDENCE`, and `step_reissued` with the parser error in the new brief |
| Worktree | Entering SCAFFOLD | CLI claims a port (`mkdir ports/<n>`), runs `git worktree add <root>/.claude/worktrees/factory-<run> -b factory/<run> <base_sha>`, adds `.claude/worktrees/` to `.git/info/exclude`, appends `stage_started{SCAFFOLD, port, worktree}`; `enter_worktree` step iff the caller's realpath cwd is outside it, verified by the next CLI call from inside | Port range exhausted → `LOCKED` |
| Scaffold | Scaffolder output parses, with `port` equal to the claimed one | CLI copies `copy_gitignored` files (each must be `git check-ignore`d) into the worktree and writes their values to `redact.json` (0600). It then issues `run_check contract.health` and `contract.test`. Both pass, plus inline `git.worktree_clean` and `git.baseline`, → `step_verified(scaffolder)` → SPEC | Any failure, a wrong port, or `STATUS: ESCALATE` → `ask_raised{escalation: E<n>}` `scaffold_failure` card |
| Scaffold ruling | Open `scaffold_failure` ask | `/factory rule E<n> retry <note…>` → reissue the scaffolder with the note in its brief. `/factory rule E<n> accept` → verify the scaffolder with the failing checks named in `evidence`, then SPEC. `/factory abandon` | Any other choice → `ILLEGAL_TRANSITION`, prompt consumed |
| Check | `factory check <step_id>` on a claimed `run_check` step | Runs the check (health first starts the dev server detached with `PORT`, pid and log in `runs/<run>/devserver.*`, and polls `health` until it passes or times out), then appends `check_ran` + `step_reported` + `step_verified` | HEAD moved since `basis_seq`'s sha → `ILLEGAL_TRANSITION`, nothing appended |
| Gate 1 | Spec step verified | `run_check spec.lint` (body ≤ `SPEC_MAX_LINES`, ≥ 1 AC, unique `AC-<n>` ids, every AC has a `command` or `page` check, an Assumptions section matching `assumptions[]`), then an `ask_human` `gate_1` card with the spec path and "N assumptions to check" | `/factory approve gate1` without a passing `spec.lint` newer than the latest verified spec → `MISSING_EVIDENCE`, prompt consumed |
| Gate 2 | SLICE_PLAN | Core derives one slice `S1` (title = task, `acs` = every AC, no tags or deps) from the pinned spec; `run_check plan.lint`; `gate_2` card shows it; `approve gate2` → `gate_2_passed{slices:[S1], pins}` → BUILD | Same evidence rule as gate 1 |
| Rework gate 1 | Open `gate_1` ask; `/factory rework gate1 <note…>` | `rework_requested{target:'gate1', note, voids}` voids the spec's `step_verified` and its `spec.lint` `check_ran` (AD-33) and closes the gate ask; `next` reissues the spec-writer with the note and the prior spec path in a fresh brief, then re-lints and re-raises gate 1 | Not at an open gate 1 → `ILLEGAL_TRANSITION` |
| Rework gate 2 | Open `gate_2` ask; `/factory rework gate2 <note…>` | Voids `plan.lint` and closes the ask; `deriveSinglePlan` attaches every gate-2 rework note to `S1.notes` (the builder brief carries them in 1-5); re-lint, re-raise gate 2; `gate_2_passed` embeds the notes | Same |
| Orphan | Claim held by a superseded session | Agent step with complete evidence → verified as is; agent step whose `subagent_stopped` arrived without a parseable output, or any claimed `run_check`/`enter_worktree` → `step_reissued` | Agent still running → left alone |
| Abandon | `/factory abandon` | 1-2's decision, plus the dev server is killed and the port released | — |

</frozen-after-approval>

## Code Map

- `src/core/schedule.ts` `due(state)` -- today INTAKE only. Becomes `due(state, ctx)`, where ctx is `{in_worktree, recon_cached}` and no I/O happens. The output is still `step_issued` data, and the CLI appends it under the lock.
- `src/core/reducer.ts` -- leave the transitions as they are: ORIENT→SCAFFOLD on `stage_completed`, SCAFFOLD→SPEC_DESIGN on the scaffolder's `step_verified`, the gates are decisions, and `escalation_ruled` closes stage asks. Store only the new optional fields on `Step` (`check`, `output`, `brief_path`, `verified_seq`) and `stage_started.port/worktree`.
- `src/core/events.ts` `DataByKind` -- additive: `step_issued.check`, `step_reported.output`, `stage_started.{port,worktree}`, `stage_completed.recon`, `check_ran.digest`, gate decisions `pins[{path,sha256}]` + `evidence[]`, `SlicePlanEntry.{acs,notes}`.
- `src/core/cards.ts` -- add `gate1Card`, `gate2Card`, `scaffoldFailureCard`, `escalationCard`; `commands` lists only legal decisions.
- `src/cli/decide.ts` `LATER` + the intake block -- generalize "verify the open `ask_human` step this decision answers" to every gate and ask. `gate_1_passed`/`gate_2_passed` and gate-target `rework_requested` leave `LATER` (an `S<n>` target is still refused), and `escalation_ruled` gains the scaffold choices. Gate evidence and `voids` come from `core/verify.ts`. The reducer already records `voided` ids, and verify/schedule must treat a voided `step_verified` or `check_ran` as absent.
- `src/cli/next.ts` `issue()` -- runs the unlocked git probes and worktree creation before the lock, verifies pending steps, then issues. `src/cli/done.ts` -- parses output and may reissue. `src/cli/start.ts` -- appends the `git.baseline` `check_ran` (porcelain=v2 digest) after `session_bound`.
- `src/cli/git.ts` -- add `repoRoot` (dirname of the common dir), `statusDigest`, `worktreeAdd`, `trackedClean`, `checkIgnored`, `head`.
- `src/store/paths.ts` -- add `portDir(n)`, `devserverPid/Log`, `briefFile`, `outFile`; `worktreePath` and `reconFile` already exist.
- `test/driver.test.ts` `world()`/`say()`/`run()` -- the harness to reuse. Add fact writers (`output_written`, `subagent_stopped`) that mimic the 1-3 hooks.
- `test/fixtures/generate.ts` -- don't regenerate; the snapshots must not change.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/output.ts` -- parse line 1 (`STATUS: DONE|ESCALATE` or `VERDICT: …`), the line-2 escalation label, and the `---` front matter. YAML subset: one `key: value` per line, where value is a plain scalar or a single-line JSON flow value.
- [x] `src/core/artifacts.ts` -- validate the context, run-contract and spec schemas (AD-27); `specLint`, `deriveSinglePlan`, `planLint`.
- [x] `src/core/verify.ts` -- agent-step evidence (path → `agent_id` → `subagent_stopped`), gate evidence, orphan classification.
- [x] `src/core/{schedule,cards,events,reducer,config}.ts` -- per the Code Map; add `HEALTH_TIMEOUT_MS` and `CHECK_TIMEOUT_MS` to config.
- [x] `src/cli/{next,done,decide,start,git,brief,check,devserver,worktree}.ts` + `main.ts` -- new verbs `check` and `devserver up|down`; `brief.ts` is the only writer of `brief.md`.
- [x] `agents/{recon,scaffolder,spec-writer}.md` -- the models per Conventions, and the output format per role. Each agent reads only its brief and the inputs it lists, and writes only `output_path`.
- [x] `skills/factory/SKILL.md` -- the conductor: `decide` → `start`/`resume` → the loop `next` → `claim` → do the step by kind → `done`. Checks run as background Bash, followed by `next --wait`. `ask_human` cards are printed verbatim to end the turn.
- [x] `test/{output,artifacts,verify,schedule}.test.ts` units + `test/pipeline.test.ts`, with one end-to-end per matrix row on a temp git repo that has a real `package.json` test and health script.

**Acceptance Criteria:**
- Given setup and a brownfield repo, when the full sequence runs through `bin/factory` with hook-format facts (start → approve intake → recon → enter worktree → scaffold → checks → spec → spec.lint → rework gate1 → second spec → spec.lint → approve gate1 → plan.lint → rework gate2 → plan.lint → approve gate2), then the run is in BUILD with slice `S1` carrying the gate-2 note, both gate decisions pin the second spec's sha256, the main checkout's `git status --porcelain=v2` equals the baseline, and every command passes `validateEvent`.
- Given the repo, when Verification runs, then all tests pass, tsc reports 0 errors, and the fixture shasums are unchanged.

## Design Notes

The front matter starts on line 2 because AD-11 owns line 1. The JSON-flow YAML subset is still valid YAML, and it keeps the CLI dependency-free. Example:

```
STATUS: DONE
---
origin: brownfield
ui_surface: true
---
```

A reissue always uses `spawn` with the error in a fresh brief, because the reducer copies the old step's kind. `resume` arrives with builder rounds in 1-5. The scaffolder step stays `reported` while its checks run, and verifies only when they all pass. The designer never runs in 1-4, so gate 1 needs no design step.

## Verification

**Commands:**
- `node --test test/` -- expected: all pass.
- `npm i --prefix "$TMPDIR/tsc" --cache "$TMPDIR/npm-cache" typescript@7.0.2 @types/node@22 && "$TMPDIR/tsc/node_modules/.bin/tsc" -p tsconfig.json --typeRoots "$TMPDIR/tsc/node_modules/@types"` -- expected: exit 0.
- `shasum test/fixtures/*.state.json` before/after -- expected: identical.

**Manual checks (if no CLI):**
- In `claude --plugin-dir .` on a small real repo: `/factory add a footer` reaches the gate 2 card with zero permission prompts for `EnterWorktree`.

## Implementation Notes

- Verification: `node --test test/` 148 pass, 0 fail (Node 26.11.1, outside the sandbox). Inside a sandbox that forbids local `listen` (EPERM), the 3 pipeline tests that start the dev server skip with that reason (144 pass, 4 skipped). tsc 7.0.2 exit 0. `test/fixtures/*.state.json` shasums unchanged (5df3b831…, 150c88c0…, 3be7b5d6…). The manual `claude --plugin-dir .` check was not run (no interactive session here).
- New files: `src/core/{output,artifacts,verify}.ts`; `src/cli/{brief,check,devserver,worktree,steps}.ts` (`steps.ts` holds what next/done/decide share: reading out.md, the projection, report/reissue events, the SCAFFOLD copy); `agents/{recon,scaffolder,spec-writer}.md` (sonnet, sonnet, opus); `skills/factory/SKILL.md` (the conductor); tests `test/{output,artifacts,verify,pipeline}.test.ts` plus `test/harness.ts` (not a test file; agent facts go through the real `bin/factory hook PostToolUse|SubagentStop`).
- Deviations, each forced by a frozen rule: (1) `Step.verified_seq` is not stored: every fixture step is verified, so any field set at `step_verified` changes the snapshots. Gate freshness uses `check_ran.digest` instead (sha256 of the exact spec file linted, and of the derived plan), which is stricter. (2) A gate-1 rework's `voids` also lists the spec step's own id (a `step_issued` event id), so state alone can tell a voided spec is not verified (AD-33: voided = absent). (3) RECON ends with `stage_completed{stage:'RECON'}`: `ORIENT` is not in the AD-5 stage enum, and the fixtures already use RECON.
- Additive state beyond the Code Map list, all absent from earlier snapshots: `Step.{check,output,brief_path}`, `Slice.{acs,notes}`, `checks[].digest`, `RunState.{port,worktree,recon}`. Additive event fields beyond the list: `Card.escalation`, `step_reissued.brief_path`.
- Interpretations: (1) Escalations (`ask_raised`) also reach the conductor as an `ask_human` step carrying the card (AD-12), and `mayStop` (core/stop.ts) skips a step that is the subject of an open escalation, so the turn can end on the card. (2) A failing `spec.lint`/`plan.lint` still raises the gate card, with the failure in `reason` and only `rework` in `commands`. (3) A main-checkout change found at the end of ORIENT is recorded as a failing `git.baseline` and enforced by SCAFFOLD's own baseline check (scaffold_failure card) before any code is written. (4) `escalation_ruled` for recon/spec-writer `ESCALATE` takes `retry <note…>` only; `accept` is for scaffold_failure. (5) The scaffolder verifies on its checks (AD-7 table); its agent facts are added to the evidence when present. (6) `factory check` writes the check's log to the step's `out.md`; `--wait` also wakes on fact-file growth. (7) `health` may be a command or an http(s) URL; polling stops early if the dev server exits. (8) `copy_gitignored` values go to `redact.json` as the value of each `KEY=value` line (≥ 4 chars). (9) Gate-2 slices are re-derived in `decide` and must match the `plan.lint` digest.
- Also closed from deferred-work: `main.ts` looks verbs up with `Object.hasOwn` (tested), and `claim --agent-id` is tested.
- Risks: (1) After a typed takeover the old session's file is deleted, so facts from an agent that session spawned are dropped by the hooks; such a step stays claimed (left alone) until the human abandons or the agent's work is redone. (2) Port claims don't probe whether the port is actually free on the machine. (3) A `run_check` or agent step reported by a superseded session is not an orphan (only `claimed` ones are); it verifies normally on its evidence.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-24): blind-hunter (B), edge-case-hunter (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| B1/E4/E5 | A refused or throwing `factory check` leaves its `run_check` claimed by the holder forever | high | `check.ts` throws after the HEAD/void/claim checks, and on a `runOne` ENOENT, without appending anything; `next` reissues only claims held by another session (`st.claimed_by !== c.session`), and SKILL.md forbids retries | patch: reissue on any refusal |
| E6 | The default 1 MB `maxBuffer` kills a verbose passing test suite, which is recorded as exit 124 | medium | `sh()` calls `spawnSync` without `maxBuffer`; when it is exceeded, `status` is null and `?? 124` applies | patch |
| B2/E1/E2/E3 | Redaction corrupts operational data: contract commands and brief paths | high | `contractOf` reads `output.front`, which `projection()` redacted with the `secretValues` of `.env` (any value ≥ 4 chars, e.g. `localhost`, `test`), so `check` runs `[REDACTED]` commands; `writeBrief` redacts the whole brief, paths included | patch: raw contract, notes-only brief redaction, skip numeric/boolean values |
| B4 | `approve gate1/gate2` is accepted with no open gate card | low | `build()` sets `answers: openAsk(...)`, which may be undefined, and never refuses; `rework` does refuse. The fix is one line | patch |
| B5/E19 | `accept` is offered and allowed with no usable run contract (scaffolder ESCALATE or wrong port) | medium | `scaffoldFailureCard` always lists accept; `decide` checks only `subject.role === 'scaffolder'`; then `contractOf` is undefined for every later check | patch |
| B8/E10 | A dev server restart spawns before the old server dies, so EADDRINUSE fails health | medium | `devserverUp` calls `killGroup` (SIGTERM) and then `spawn` with no wait; a scaffold retry that changes `start` hits this | patch |
| B10/E17 | Retry briefs miss the failure reasons, and later reissues drop the human's retry note | medium | `reissueEvent(c, run, subject, {notes})` passes only the note; `briefText` re-derives notes only from gate-1 reworks | patch |
| E20 | `done` on enter_worktree from outside the worktree leaves an unverifiable reported step, and SCAFFOLD stalls | medium | `done.ts` appends `step_reported` without verification; `stepEvents` verifies only when `ctx.in_worktree`; `scaffold()` sees the open step and issues nothing | patch: MISSING_EVIDENCE + reissue |
| B14/E21 | scaffolder.md allows "the repo's own scripts" yet forbids starting servers | low | Steps 2 and 3 conflict; this is a direct text fix | patch |
| V1 | Failing `git.worktree_clean`/`git.baseline` at SCAFFOLD are untested | medium (pre-verified) | Every test repo stays clean, so forcing `trackedClean` to true keeps the suite green | patch: test |
| V2 | Non-scaffolder ESCALATE → escalation card → retry/accept is untested | medium (pre-verified) | `escalationCard` appears in no test; deleting the branch keeps the suite green | patch: test |
| V3 | `copyGitignored` refusals are untested | medium (pre-verified) | No test imports `worktree.ts`; deleting the `..` or ignored check keeps the suite green | patch: test |
| V4 | The secret-redaction assertion can't fail | medium (pre-verified) | Nothing recorded in the acceptance test ever contains `SECRET` | patch: test |
| V5 | URL health, an exiting dev server, and a changed `start` are untested | medium (pre-verified) | Every contract uses `npm run health` and the same `start` | patch: test |
| B6/E18 | Agent reissues have no ceiling, so bad output can loop forever | medium | `done`/orphan paths reissue with `attempt+1` unconditionally; the spec doesn't settle a cap or the card it would raise (AD-24's overdue → ask_human is out of scope here) | defer |
| E7 | Grandchildren holding the check's pipes may defeat the `spawnSync` timeout | maybe-false (medium if true) | Settle by running a check whose command backgrounds a `sleep` that inherits stdout, with a short timeout | defer |
| V6 | `next --wait` waking on fact-file growth is untested | low | Latency only: the next round still verifies | reject |
| B3 | A gitignored symlink pointing outside the repo is copied | low | The threat model is a wrong LLM, not an adversary (AD-31); the target is the user's own file, and its values get redacted | reject |
| B7/E16 | A corrupt cache or deleted recon output wedges ORIENT | low | `publishRecon` only publishes verified, parsed text; corruption needs a human edit under `~/.factory` | reject |
| B8b/E9/E11 | Dev server pid reuse, or a leader exiting while children keep the port | low | Needs pid reuse or a `start` that backgrounds itself; the fix adds process identity tracking | reject |
| B9/E12/E13 | Port claims leak on a crash between mkdir and the owner write, or an abandon mid-`next` | low | Two-syscall crash windows; AD-20 releases only on terminal runs by design | reject |
| B11 | Abandon leaves the worktree, the branch and the copied `.env` | low | The spine's housekeeping removes the worktree only after `merged` (1-5); branches are kept by design; the `.env` is a copy of the repo's own gitignored file | reject |
| B12 | The `devserver` verb isn't in the conductor skill | low | The spec asked for the verb; the conductor needs no manual server control in 1-4 | reject |
| B13 | `addRedactValues` read-merge-rename can race | low | Needs two concurrent scaffolder copies (done plus an orphan verify) on one run | reject |
| B15 | `projection.lines` and `specLint.lines` count differently | low | Display-only; the gate uses specLint's count | reject |
| B16 | Misleading labels: `worktree add` as BAD_ARGS, an unreadable spec as "changed" | low | Messages only; behavior is correct | reject |
| B17 | `brief`/`devserver`/`worktree`/cards lack unit tests | low | The behavior is covered end to end; the specific gaps are V1–V5 | reject |
| E8 | Abandon during a background health check can orphan the dev server | low | Needs an abandon typed during the few seconds the server starts | reject |
| E14 | A deleted but still registered worktree makes `worktree add` fail | low | Needs a human deleting the worktree mid-run | reject |
| E15 | Submodules or `--separate-git-dir` give the wrong `repoRoot` | low | The spec Code Map fixes `repoRoot` = dirname(common dir); interview repos are plain checkouts | reject |
| V-other | Dev-server tests skip under a sandbox that forbids `listen` | false | Not a defect: verification ran outside the sandbox, 148/148 | reject |
