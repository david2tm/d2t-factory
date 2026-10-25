---
title: 'Greenfield path'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_commit: 'c473324556d39b975cbfd2d2234e40c539d9903e'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/factory <task>` in an empty, non-git directory fails at once: `decide` and `start` both need a repo hash. Behind that, the reducer, board and designer already know `greenfield`, FRAME and invent mode, but nothing issues FRAME, SCAFFOLD briefs only cover brownfield, and `rerun FRAME` is refused as "lands in 5-2" (CAP-3, CAP-4, CAP-6).

**Approach:**
1. `start` initialises the directory per AD-9.
2. A new `framer` agent orients the run in place of RECON, emitting the same context schema with `origin: greenfield` and its UI kit as `ui_reference`.
3. The scaffolder creates the project with its own test runner, and the CLI commits it as the scaffold.
4. Every later stage then runs unchanged, invent mode included.

## Boundaries & Constraints

**Always:**
- **Non-empty non-git cwd (decided at review, 2026-10-25).** `start` refuses with `BAD_ARGS` and writes nothing when the cwd is not inside a git repo and holds any entry: greenfield starts only in an empty directory.
- **Non-git cwd.** Otherwise `start` runs `git init`, then makes the empty commit `factory: init`, before anything is claimed. A git repo with no commit gets only that commit, built from the empty tree so a staged index is never committed. Commits use the CLI's fallback identity and `--no-verify`.
- **Origin.** A run is greenfield iff HEAD's tree is empty after that step. A git repo with tracked files stays brownfield, unchanged.
- **Decide in a non-git cwd.** It answers a task or a bare `/factory` with `resolution: {none: true}` and refuses a decision with `NOT_FOUND`. It writes nothing.
- **Agent origin.** `framer` output must say `origin: greenfield` and `recon` output `origin: brownfield`. Invent mode is reached only through FRAME.
- **FRAME.**
  - It runs in the main checkout, read only.
  - With a UI surface it names a UI kit (default shadcn-class) as `ui_reference`.
  - It asks the human nothing.
  - `stage_completed{stage: FRAME}` embeds its output `{path, sha256, context}` in the existing `recon` field.
  - Nothing goes to the recon cache.
- **SCAFFOLD done (greenfield).** Health and test pass, and the CLI has committed the worktree as `factory: scaffold (<step_id>)`, so the tree is not empty. With an empty tree the run gets a scaffold_failure card with `the scaffolder created no project files`.
- **Reruns.** `/factory rerun FRAME` works like `rerun RECON`. It is refused on brownfield runs, and `rerun RECON` is refused on greenfield runs.

**Never:**
- No change to the event schema or the reducer.
- No change to the board (the origin tag and the FRAME card already exist).
- No second pipeline: from SCAFFOLD on, only the briefs' wording differs by origin.
- No human question at FRAME.
- No git writes to the main checkout beyond the init commit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Errors |
|---|---|---|---|
| Empty dir | `/factory add a todo app` in a non-git dir | `decide` → `intent: start`, `none`. `start` → `.git` and one commit `factory: init`. `run_started.greenfield: true`, and `base_sha` is that commit. | N/A |
| Non-empty, no repo | `/factory <task>` in a non-git dir holding `notes.md` | No `.git` is created and nothing is claimed; the prompt stays unconsumed | `BAD_ARGS` naming the directory |
| Repo, no commit | `git init` done, a file staged | `factory: init` has an empty tree. The staged file is still staged and not committed. Greenfield. | N/A |
| Decision, no repo | `/factory approve gate1` in a non-git dir | Nothing is written | `NOT_FOUND` |
| ORIENT, greenfield | Intake approved | One `d2t-factory:framer` spawn at stage FRAME, with a brief naming the dir and format | N/A |
| Wrong origin | framer writes `origin: brownfield` (or recon writes `greenfield`) | Rejected and reissued | `MISSING_EVIDENCE` |
| Empty scaffold | Scaffolder wrote only the contract | scaffold_failure card (retry, abandon) | — |
| Rerun at gate 1 | Greenfield, parked at gate 1 | framer attempt 2, then the cycle continues as for RECON | Brownfield `rerun FRAME` → `ILLEGAL_TRANSITION` |

</frozen-after-approval>

## Code Map

- `src/cli/git.ts`:
  - Add `initGreenfield(cwd)`, built from `git()`/`gitOrThrow`/`identity`. Use `git hash-object -t tree /dev/null`, then `commit-tree`, then `update-ref HEAD`.
  - Add `emptyTree(cwd)`.
  - `commitAll` already covers the scaffold commit.
- `src/cli/start.ts:37` -- After the prompt is parsed and before `repoHash`: when not in a repo or no HEAD, call `initGreenfield`. Then set `greenfield` from the empty-tree test into `run_started` (`events.ts:79` already has the field).
- `src/cli/decide.ts:275` -- `repoHash` throws `BAD_ARGS` outside a repo. Guard it as the matrix says. Also edit `:68` `RERUN_STAGES` and `:226-228` (drop the 5-2 refusals and add the origin checks).
- `src/core/schedule.ts:66` -- `orient()`: for greenfield, issue `agent('framer', 'FRAME', …)` with the same attempt and void logic as recon.
- `src/cli/next.ts`:
  - `completeOrient` (:162) and `prepare` (:385): greenfield takes the verified framer output instead of the cache. It writes the baseline check, then `stage_completed{stage:'FRAME', recon}`, then completes SCAFFOLD after a rerun as now.
  - `probe` (:127): `recon_cached` only when not greenfield.
  - `finishScaffold` (:190): for greenfield, after `git.worktree_clean`, commit if the worktree is dirty, and fail on an empty tree. Add `scaffold:<sha>` to the evidence.
- `src/core/artifacts.ts:182` -- `OutputOpts` gains `origin`. `checkOutput` maps `framer` to `validateContext` and enforces origin by role. `steps.ts:27` `outputOpts` passes it.
- `src/cli/brief.ts`:
  - FORMAT gains `framer`: the stack, install/start/test, layout, and the shadcn-class default kit.
  - The `scaffolder` text splits by `state.greenfield`. Greenfield: create the project, its own test runner with at least one passing test, start on `PORT`, a `.gitignore` for dependencies and build output, installs via its own `install`, no commit.
  - `inputs()` (:169): framer reads the directory. Others read "project frame from FRAME" when greenfield.
- `agents/framer.md` (new, sonnet, mirrors `recon.md`), `agents/scaffolder.md` (both modes per brief).
- Already done, reuse unchanged:
  - `verify.ts:45-48,90` (designerRequired, designMode, uiReference);
  - `rerunVoids` (FRAME has RECON's rank);
  - reducer, projection, roster, dashboard.
- Tests:
  - `test/harness.ts:32` `world()`: add an option for an empty non-git dir.
  - `test/pipeline.test.ts:1153` `inventRecon`, `toSpecDesign`: the invent tests move to a greenfield run.
  - `:1811`: drop the 5-2 refusal.
  - `test/schedule.test.ts:66-71`.

## Tasks & Acceptance

**Execution:**
- [x] `src/cli/git.ts`, `src/cli/start.ts` -- greenfield init and origin detection.
- [x] `src/cli/decide.ts` -- decide outside a repo, and the FRAME/RECON rerun rules.
- [x] `src/core/artifacts.ts`, `src/cli/steps.ts` -- the framer schema and origin enforcement per role.
- [x] `src/core/schedule.ts`, `src/cli/next.ts` -- issue and complete FRAME, plus the greenfield SCAFFOLD commit and its failure.
- [x] `src/cli/brief.ts`, `agents/framer.md`, `agents/scaffolder.md` -- framer and greenfield scaffolder briefs.
- [x] `test/harness.ts`, `test/pipeline.test.ts`, `test/driver.test.ts`, `test/schedule.test.ts`, `test/artifacts.test.ts` -- every matrix row, plus moving the invent tests onto a greenfield run.

**Acceptance Criteria:**
- Given an empty dir, when a greenfield run goes through intake, FRAME (UI surface, kit `shadcn/ui`), SCAFFOLD (the scaffolder writes a node app and a contract), SPEC_DESIGN and gate 1, slice plan, BUILD and merge, then:
  - every stage after FRAME issues the same step kinds as brownfield;
  - the designer brief says `designer mode: invent` and names the kit;
  - reviewer-ui is on UI slices with the kit as its reference;
  - the merged main branch holds `factory: init`, `factory: scaffold`, and the slice commits.
- Given the existing brownfield suites, when run, then they pass unchanged apart from the moved invent tests, and the recording snapshots are byte-identical.

## Implementation Notes

- Origin is enforced by role in `checkOutput` (`originOf`: framer → greenfield, recon → brownfield), so the recon cache read also rejects a greenfield context. `OutputOpts.origin` carries the run's origin and rejects a role that doesn't orient that run.
- `checkOutput` also rejects a framer `STATUS: ESCALATE` (like intake), so FRAME can never raise a human ask.
- The empty-scaffold test runs before the commit: HEAD's tree is empty and the worktree is clean. The scaffold commit happens only when nothing else fails, so a retry can rewrite the uncommitted files without tripping `git.worktree_clean`.
- reviewer-ui on a greenfield run gets an extra brief fact, `UI kit chosen at FRAME (reference): <kit>`. `uiReference` (unchanged) still returns the design path first.
- The driver test world now commits a README: an empty-tree initial commit would make it greenfield.
- A greenfield scaffold_failure never offers accept: an accepted scaffold would have no scaffold commit.

## Spec Change Log

## Review Triage Log

Review pass 1 (blind-hunter BH, edge-case-hunter ECH, verification-gap VG):

| # | Finding | Verdict | Evidence / route |
|---|---|---|---|
| ECH3 / ECH4 / ECH11 / BH2 / BH4 | A would-be greenfield cwd that already holds files becomes greenfield anyway; the frame and scaffold never see those files, and the merge can collide with them | medium | Confirmed: `initGreenfield` + `headTreeEmpty` ignore untracked content, and the worktree starts from the empty init commit. The intent said "non-git cwd → git init" but never what to do with existing files. **intent_gap**, answered by the human: refuse a non-empty non-git cwd (recorded in the frozen intent); the code was kept and the guard patched on top, at the human's choice. |
| VG2 | The "existing empty-tree commit → greenfield" rule is untested; `test/hooks.test.ts`'s `--allow-empty` fixture now starts greenfield runs silently | medium | Gap filed pre-verified; confirmed at `test/hooks.test.ts:41`. **patch** |
| ECH7 / BH5 | `rule E<n> accept` on a greenfield scaffold_failure verifies with no scaffold commit | medium | Confirmed: `accept: !conflict && !empty`. It breaks the frozen rule "SCAFFOLD done (greenfield) = health + test pass and the CLI committed". **patch**: offer no accept on greenfield |
| VG1 | The rerun framer brief is never checked for no port, worktree or prior frame | low | Gap filed pre-verified: only the first brief is asserted, where those can't exist. **patch** |
| ECH5 | `dirty()` follows the user's `status.showUntrackedFiles=no` and then reports a false "created no project files" | low | Confirmed: `git status --porcelain` honours that config. **patch**: pass `--untracked-files=all` |
| BH9 | `agents/scaffolder.md` step 4 doesn't say `copy_gitignored` is `[]` on greenfield | low | Direct doc fix. **patch** |
| BH10 | The default kit is hardcoded beside `DEFAULT_UI_KIT` in the framer example | low | Direct fix: interpolate it. **patch** |
| BH11 | `finishScaffold` ignores `commitAll`'s return and calls `head(wt)` again; `dirty` runs twice | low | Direct correction. **patch** |
| ECH1 / BH12 / VG-other | A refused start leaves `.git` and `factory: init` behind | false | In a fresh repo `refuseOtherBinding` (a new `repo_hash`) and `exclusiveHolder` (no claims) can't refuse; only a LOCKED or append failure remains, after AD-9's mandated init. |
| ECH2 | Two concurrent starts in one unborn dir race `update-ref` | low | Needs two simultaneous starts in one empty dir; the fix adds a retry branch. Rejected. |
| ECH6 / BH7 | No `.gitignore` → `node_modules` lands in the scaffold commit | low | The brief requires a `.gitignore`; enforcing it adds a new check. Rejected. |
| ECH8 / BH6 | A scaffolder that commits itself goes unnoticed | low | Against its instructions; the content is still the scaffold. The fix adds a check. Rejected. |
| ECH9 | Two parallel greenfield runs conflict at merge | low | Unusual; the merge card reports the conflict. Rejected. |
| ECH10 | Driver fixture change hides that an empty-tree repo is now greenfield | false | Required by the frozen origin rule and recorded in Implementation Notes. The test gap is VG2. |
| BH1 | `rerun FRAME` keeps a scaffold built from the old frame | false | Intended: frozen "rerun FRAME works like rerun RECON" (Design Notes). The fix would edit the spec. Rejected. |
| BH3 | An empty subdirectory of a repo runs brownfield on the parent | false | AD-9 derives identity from the git common dir; the frozen rule "a git repo with tracked files stays brownfield". |
| BH8 | "At least one passing test" is never checked | low | Not mechanically checkable beyond `contract.test`. Rejected. |
| BH13 | Missing tests: ui_surface false end to end, other verbs outside a repo, greenfield replay | low | `status`/`next`/`resume` outside a repo have no run to act on (pre-existing BAD_ARGS); the scaffold-failure test runs `ui_surface: false`. Rejected. |

## Design Notes

FRAME reuses `stage_completed.recon` (`ReconEmbed`) rather than adding a field, so the reducer, verify helpers and replay fixtures need no change. The scaffold gets its own commit so that slice 1's builder commit, and so its review, holds only slice work. `rerun FRAME` keeps a verified scaffold, as `rerun RECON` does. A rerun that picks another stack doesn't rebuild the project; the human abandons instead.

## Verification

**Commands:**
- `node --test test/` -- expected: all pass; `test/fixtures/recordings/*` unchanged (`git status`)
- `npx tsc --noEmit -p .` -- expected: no new errors (one pre-existing in `test/web-replay.test.ts`)
