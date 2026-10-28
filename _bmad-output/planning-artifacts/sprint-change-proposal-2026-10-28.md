---
title: 'Sprint change proposal: dry run 3 findings 1, 2'
date: '2026-10-28'
status: 'approved'
approved: '2026-10-28'
mode: 'batch (autonomous, delegated by d2t)'
trigger: '_bmad-output/implementation-artifacts/dry-run-3-findings.md'
scope: 'moderate'
---

# Sprint Change Proposal — dry run 3, findings 1, 2

## 1. Issue summary

Dry run 3 (2026-10-28, brownfield, `maciekt07/TodoApp`, run `i-want-to-add-an-optiona-7sdp`, Claude Code 2.1.312, sandbox on) stopped at the start of SCAFFOLD.

| # | Kind | Problem, in one line | Root cause in the contract |
|---|---|---|---|
| 1 | blocker | `git worktree add` fails because the sandbox refuses to write the tracked `.vscode/settings.json`. The error comes back as `BAD_ARGS`, and the run branch is left behind with no worktree. | AD-15 assumes git can check out every tracked file into the worktree. AD-35 treats the sandbox as a list of exceptions that setup patches. Neither knows that the sandbox refuses some paths regardless of the writable roots. No test runs the CLI's git under the sandbox. Every dry run so far has hit a different symptom of this. |
| 2 | UX | Nothing tells the human when `/clear` is safe. | Resume after `/clear` works (spike 06), but no card says so. |

### Spike 09, run during this correct-course (2026-10-28, Claude Code 2.1.312, sandboxed Bash in this repo)

The findings asked for a spike that pins the protected paths before any decision. It ran here, in a few minutes, against the same Claude Code version (evidence in `spike-results.md` section 09):

- **The rule is a pattern, scoped to the session's working directory.** Under the cwd, at any depth, the sandbox refuses writes to files inside `.vscode/`, `.idea/`, `.claude/commands/`, `.claude/agents/` and `.git/hooks/`, and to the files `.gitmodules`, `.mcp.json`, `.gitconfig`, `.bashrc`, `.bash_profile`, `.zshrc`, `.zprofile`, `.profile` and `.ripgreprc`. Creating the directories themselves is allowed. Under `$TMPDIR`, an `allowWrite` root, all of them are allowed. `.gitignore`, `.gitattributes`, `.npmrc`, `.env`, `.husky/*`, `.github/*` and `.claude/skills/*` are allowed. This session's settings additionally deny this repo's own top-level `.claude/settings*.json` by absolute path.
- **The list is wider than the finding assumed.** `.mcp.json` and `.gitmodules` are common in brownfield repos. d2t-factory tracks `.mcp.json` itself, so the factory could not run on its own repo today.
- **Reproduced:** `git worktree add` under the cwd of a repo that tracks `.vscode/settings.json`, `.mcp.json`, `.gitmodules` and `.claude/commands/c.md` fails exactly as in dry run 3 (`unable to create file …: Operation not permitted`, `fatal: Could not reset index file`).
- **The fix works:** `git worktree add --no-checkout`, then `git reset -q` (index only), then `git checkout-index -a`. `checkout-index` writes every file it can and names every file it can't. Marking the refused files `skip-worktree` leaves `git status` clean. `git add -A` plus a commit leaves those files untouched, the commit's tree still holds them, and the `--no-ff` merge back into the main checkout succeeds.
- **One new hazard:** integrating a target that changed a refused file since the base fails. Git also writes the target's other new files before failing, without a `MERGE_HEAD`, so `mergeInto`'s abort never runs and the worktree is left dirty (an untracked `src/c.ts` in the probe).

## 2. Impact analysis

### Epics and stories

All 21 stories (0-1 … 7-2) are built, and none is invalidated. The changes amend:

| Finding | Stories it amends |
|---|---|
| 1 | 1-4 (CLI-created worktree), 1-5 (WRAP integration and merge), 1-1 (`factory setup`, error codes), 7-1 (sandbox rule: what a denial looks like) |
| 2 | 6-2 (card lines), 2-2 (Needs You card) |

**Proposed:** epic 8, *Dry run 3 product changes*, with two stories (section 4.4). 8-1 blocks dry run 4. 8-2 is small and independent.

### Artifact conflicts

| Artifact | Sections affected |
|---|---|
| `SPEC.md` | Constraints (sandbox bullet) |
| `ARCHITECTURE-SPINE.md` | AD-15 (creating the worktree, refused paths, integration), AD-35 (the sandbox as a designed dependency), Consistency Conventions (error codes), Open Questions (spike 09 row), `updated` |
| `spike-results.md` | New section 09 |
| `EXPERIENCE.md` | Stage lifecycle SCAFFOLD row, Chat surfaces (gate/escalation message) |
| `stories.yaml` | Stories 8-1, 8-2 |
| `deferred-work.md` | Two new items |
| `dry-run-3-findings.md` | Pointer to these decisions |

### Technical impact

No new process, route or dependency. There are two additive event fields (`stage_started.readonly_paths`, `Card.clear_safe`), which need no upcaster (AD-32), and one new CLI error code (`SANDBOX_DENIED`). Worktree creation changes from one git command to four. The final merge path is unchanged.

## 3. Recommended approach

**Direct adjustment.** The worktree checks out what the sandbox allows, the paths it refuses become read-only for the run, and the sandbox becomes a designed dependency: probed at `factory start`, named in errors and covered by a test. A rollback gains nothing. An MVP review isn't needed: the success signal (a brownfield run to merge) can't be met without this.

Alternatives rejected:

| Option | Why not |
|---|---|
| A hard-coded list of protected paths, with `git sparse-checkout` | The list changes between Claude Code versions (it is how dry run 3 broke). Sparse-checkout in a linked worktree also sets `extensions.worktreeConfig` in the target repo's `.git/config`. The empirical `checkout-index` result needs no list. |
| Worktree under `~/.factory` (an `allowWrite` root, where the pattern rule didn't apply in `$TMPDIR`) | Spike 01: `EnterWorktree` outside `.claude/worktrees/` prompts every time and can't move between such worktrees. |
| `sandbox.excludedCommands: ["factory"]`, or running git unsandboxed | Breaks the SPEC constraint and AD-35. The CLI also runs LLM-authored run-contract commands, so excluding it would run those unsandboxed. |
| Only patch `.vscode` | The fourth patch for the same root cause. `.mcp.json` and `.gitmodules` would break the next repo. |

- **Effort:** 8-1 medium (worktree procedure, integration pre-check, error mapping, start preflight, conformance test, README). 8-2 low.
- **Risk:** low to medium. A builder that runs `git reset --hard` or `git checkout .` in the worktree could clear skip-worktree bits, but builders never run git (AD-8), and the slice-close `trackedClean` check would catch the result. A slice that genuinely needs to change a refused file fails on the sandbox denial, which is the AD-35 ordinary-failure path, and its card names the file.
- **Timeline:** about one dev session for 8-1 and half a session for 8-2, then dry run 4.

## 4. Detailed change proposals

### 4.1 Finding 1: the worktree checks out what the sandbox allows; refused paths are read-only for the run

**Decision.**

1. **Creating the worktree (AD-15).** The CLI creates the worktree in four steps:
   1. `git worktree add --no-checkout <path> -b factory/<run-id> <base_sha>`;
   2. `git reset -q` in the worktree (index only);
   3. `git checkout-index -a`, which writes every file it can;
   4. every tracked file still missing on disk (`git ls-files --deleted`, so no stderr is parsed) is marked `git update-index --skip-worktree`.

   `git status` is then clean, so SCAFFOLD's "no tracked changes" check holds. The missing files are recorded as `stage_started.readonly_paths` (SCAFFOLD) and listed as a detail on the SCAFFOLD and gate-1 cards: "Read-only in this run (the sandbox refuses them): .vscode/settings.json, .mcp.json". With the sandbox off, or in a repo without such paths, the list is empty and nothing shows. There is no hard-coded list: whatever the installed Claude Code refuses is what gets skipped.
2. **Read-only means read-only.** Agents read a refused file from the main checkout path given in their brief. A change to one is refused by the sandbox, which is the AD-35 ordinary failure on that path (agent failure or escalation, naming the file). Commits never touch these files, because `git add -A` honours skip-worktree, and the final merge never writes them, because the run branch never changes them.
3. **Integration (AD-8 WRAP).** Before integrating the target into the run branch, the CLI checks `git diff --name-only <base>..<target>` against `readonly_paths`. If they overlap, it doesn't integrate. The WRAP card without the merge says: "The target changed <paths> since the run started, and the sandbox won't let the factory check them out. Merge by hand in your own terminal, or abandon." A failed integration of any kind now leaves the worktree as it was (the non-conflict failure in spike 09 left a stray file).
4. **Failure clean-up.** If the worktree add fails after it created the branch, the CLI deletes that branch (it has no commits).
5. **Errors name the sandbox.** A git or filesystem `EPERM`/`EACCES` in the CLI maps to the new code `SANDBOX_DENIED`, never `BAD_ARGS`. The message names the path and says "the sandbox refused this; it is a factory defect, report it (AD-35)". The conductor's existing error rule applies: print it in one line and end the turn. It never suggests a settings change (7-1).

### 4.2 Finding 1: the sandbox is a designed dependency (AD-35)

**Decision.** AD-35 gains three rules, so the next Claude Code change breaks a check or a test, not a dry run:

1. **Preflight at `factory start`.** `start` probes, from the CLI process (which runs inside the session's sandbox):
   - creating and removing a file under `<repo>/.claude/worktrees/`;
   - opening `.git/info/exclude` for append without writing;
   - writing under `~/.factory/<repo-hash>/`;
   - when `settings.json` has the sandbox enabled, binding `127.0.0.1:0`.

   A failed probe refuses the run with `SANDBOX_DENIED`, naming the path or the `allowLocalBinding` setting, before any state is written.
2. **The refused-path rule is learned, not listed.** The factory never keeps a list of protected paths. The worktree checkout finds them (4.1). Spike 09 records the 2.1.312 list for reference only.
3. **Sandbox conformance test.** `test/sandbox.test.ts` builds a fixture repo with plumbing only (`hash-object`, `update-index --cacheinfo`, `commit-tree`, so creating it writes no refused path). The repo tracks `.vscode/settings.json`, `.mcp.json`, `.gitmodules` and `src/a.ts`, and its worktree goes under a gitignored dir inside the session cwd (`test/.sandbox-tmp/`). The test runs the real CLI functions:
   - `prepareWorktree`;
   - `trackedClean`;
   - `commitAll`;
   - an integration where the target changed a refused path (refused, worktree unchanged);
   - the final `--no-ff` merge;
   - the `start` preflight.

   It detects the sandbox by probing a write to `.mcp.json` under that dir. Sandboxed, it asserts the refused paths are `readonly_paths`. Unsandboxed, it asserts the list is empty and that everything else passes the same way. Its first line of output says which mode ran. **Rule:** after a Claude Code upgrade, `npm test` runs once from a sandboxed Claude Code session before the next dry run, and the dry-run checklist records that line.
   - Known limit, accepted: the cwd-inside-worktree case (dry run 2 finding 3) can't be reproduced in one test session. It stays covered by AD-15's exit-before-merge order and by dry runs.

### 4.3 Finding 2: cards say when `/clear` is safe

**Decision.** Adopted as the finding proposed, with one rule for "nothing in flight": the run is **parked** (`isParked`, AD-12: every open step waits on the human, so the conductor has no background agent, check or `--wait` running).

- `next` sets `clear_safe: true` on a card when the run is parked and the card is not the WRAP merge card. The merge card stays excluded until the deferred `ExitWorktree`-after-`/clear` item is settled. The INTAKE conversation has no card, so it is excluded by construction. The intake confirm card qualifies, because the intake is on disk by then.
- `cardLines` appends one line after the reply: "Safe to `/clear` here: the run is saved. After clearing, type one of the commands above." The Needs You card renders the same line (single-sourced, AD-34).
- No event change beyond the additive `Card.clear_safe`. Old recordings render without the line.

### 4.4 Stories

```yaml
- id: "8-1"
  title: The worktree checks out what the sandbox allows; the sandbox is tested
  description: >-
    Worktree creation via --no-checkout + checkout-index + skip-worktree with readonly_paths on the
    SCAFFOLD and gate-1 cards; integration refused when the target changed a read-only path and
    clean on any failure; branch clean-up on a failed add; SANDBOX_DENIED; the factory start
    preflight; the sandbox conformance test; README (dry run 3 finding 1; CAP-4, CAP-12, AD-35).
  invoke_dev_with: >-
    Governing decisions: AD-8, AD-15, AD-32 (additive fields), AD-35. Spike 09 in spike-results.md
    has the reproduction. Source: planning-artifacts/sprint-change-proposal-2026-10-28.md
    sections 4.1, 4.2.

- id: "8-2"
  title: Cards say when /clear is safe
  description: >-
    clear_safe on a card when the run is parked and the card is not the merge card; one line in
    cardLines and the Needs You card (dry run 3 finding 2; CAP-1).
  invoke_dev_with: >-
    Governing decisions: AD-12 (isParked), AD-34. Source:
    planning-artifacts/sprint-change-proposal-2026-10-28.md section 4.3.
```

**8-1 acceptance highlights:**
- With the fixture repo under a sandboxed session, the run reaches SCAFFOLD done with `readonly_paths` = the four refused files and `git.worktree_clean` passing.
- `src/a.ts` edits commit and merge back.
- A target change to `.vscode/settings.json` gives the integration card, and the worktree status is unchanged.
- A forced `worktree add` failure leaves no `factory/<run-id>` branch.
- `start` without `allowLocalBinding` in a sandboxed session refuses with `SANDBOX_DENIED` before `run_started`.

**8-2 acceptance highlights:**
- Gate 1 and gate 2 cards carry the line.
- An escalation card raised while another slice's reviewer is running does not.
- The merge card never does.

## 5. Implementation handoff

- **Scope:** moderate. It changes the contract in four files plus two new stories. Epics 1–7 are not replanned.
- **Route:** Developer agent (`bmad-build`) for 8-1, then 8-2. The contract edits in section 4 are applied with this proposal.
- **Success criteria:**
  - dry run 4 on TodoApp (sandbox on, 2.1.312 or later) passes SCAFFOLD with `.vscode/settings.json` read-only;
  - `npm test` from a sandboxed session reports sandboxed mode and passes;
  - the five `[dry run 3]` items in `deferred-work.md` are exercised in dry run 4.
