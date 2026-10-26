# Dry run 2 — findings (2026-10-26)

Brownfield dry run after epic 6. Brownfield on `maciekt07/TodoApp` again, task "add an optional task giver to each todo". Run `i-want-to-add-an-optiona-znad`: 3 slices built, reviewed (code, security, ux, a11y, ui all APPROVE) and closed, then the merge failed in WRAP.

**Passed:** the run reached the merge gate (dry run 1 stopped in BUILD); every slice closed with all five reviewers approving.

**Evidence kept:** the run was cleaned up afterwards (worktree, branch and `~/.factory` run state deleted). Archived first in `~/.factory/archive/dry-run-2-2026-10-26/`: `run.tgz` (event log, facts, artifacts, recon; dev-server cache left out), `playwright.tgz` (reviewer snapshots and screenshots), and `branch.bundle` (the 3 slice commits, tip `c7eab70`; restore with `git fetch <bundle> factory/i-want-to-add-an-optiona-znad`). The Claude session transcripts are untouched.

Recorded as observations only. Decisions come later.

| # | Kind | Finding | Evidence |
|---|---|---|---|
| 1 | dashboard | Spec writer, scaffolder and other roles have no avatar of their own. Only seven roles have a character (`BY_ROLE`, `src/dashboard/web/src/lib/sprites.ts:19`; `ROSTER`, `src/dashboard/web/src/lib/model.ts:210`): builder, designer and the five reviewers. Recon, framer, scaffolder, spec-writer and slicer fall back to the conductor sprite (`vess`) and show the raw role id as their name. EXPERIENCE.md intended this for RECON/FRAME ("No sprite on the card; the conductor in the Swimlane head"), but on the board these roles still read as anonymous agents. Open question: give every role a persona (name, sprite, color)? | observed on the board |
| 2 | dashboard | The CLI checks `contract.install`, `contract.health` and `contract.test` show by their internal ids. They are the factory's own steps (`CONTRACT_CHECKS`, `src/core/verify.ts:151`), so they could get invented names, perhaps as droids alongside the characters. | observed on the board |
| 3 | **blocker** | The sandbox blocks `/factory merge`. `mergeRun` (`src/cli/decide.ts:253`) runs `git merge --no-ff` in the main checkout, and the sandboxed CLI can't write main's files, so git aborted the merge (cleanly; nothing merged). Same family as dry run 1 finding 1 (`factory setup` doesn't prepare the sandbox for what the factory needs; today it only adds `~/.factory` to `allowWrite`, `src/cli/setup.ts:37`). **Root cause (confirmed):** wrong order in WRAP. The conductor enters the worktree at SCAFFOLD (`EnterWorktree`) and leaves it only *after* the merge (`merged()`, `src/core/schedule.ts:238`). The sandbox lets a command write only under the session's current directory, so during the merge that was the worktree, and git couldn't replace files in the main checkout. The comment at `src/cli/setup.ts:47` assumes the merge needs no sandbox rule; no test runs under the sandbox, and dry run 1 never reached the merge. | transcript: `git merge into main failed and was aborted: error: unable to unlink old 'src/components/tasks/EditTask.tsx': Operation not permitted` (same for 5 more files); session cwd was the worktree for 677 of 777 entries; `check_ran git.merged exit_code 1, 78 ms` at 08:54:15 |
| 4 | **blocker** | A failed merge strands the run. `merge_approved` and `step_verified` for the merge card are written *before* the merge runs, and nothing reopens the card when `git.merged` fails, so the run sits in WRAP with no open ask. The conductor told the human to type `/factory merge` again, but by the code that would be refused too (`merge_approved: no open merge card`, `src/cli/decide.ts:205`; not tried). There is no retry path short of `abandon`. | event log ends `merge_approved` → `step_verified` (merge card) → `check_ran git.merged exit 1`, nothing after; the conductor's unsandboxed retry got `NO_HUMAN_PROMPT: no unconsumed /factory prompt` |
| 4b | bug | The failed `git.merged` check records only the exit code. Git's error text goes into the thrown `CHECK_FAILED` message (`src/cli/decide.ts:269`) but not the event log, so the board and the recording can't say why. | `check_ran` data has no output field |
| 5 | design | After the failure, the conductor decided on its own to retry outside the sandbox and asked the human to type `/factory merge` again so it could "run the merge outside the sandbox from the start". It also suggested `/sandbox` to allow writes to the repo's `src/`. The factory has no rule on whether the conductor may bypass the sandbox, and the fix it suggests is the human's to make, not part of the closed list. | same transcript |

**Decided:** findings 1, 2 and 5 in `planning-artifacts/sprint-change-proposal-2026-10-26.md` (approved 2026-10-26): 5 is story 7-1, and 1 and 2 are story 7-2. Findings 3, 4 and 4b are fixed (`50ce7f5`, `ed681e0`).

Cleanup note: stopping the dev server and the dashboard needed a kill outside the sandbox (`kill … operation not permitted`), the same limit as dry run 1 finding 11.

## Not reached yet

A successful merge (and the commit-hook question from `deferred-work.md`), recording and replay.
