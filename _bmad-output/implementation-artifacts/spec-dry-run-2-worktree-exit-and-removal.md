---
title: 'Dry run 2 follow-ups: keep worktrees, way out when ExitWorktree is a no-op'
type: 'bugfix'
created: '2026-10-26'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/spec-dry-run-2-wrap-merge-fix.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** (1) Under the sandbox, the CLI's post-merge `git worktree remove` fails for the worktree the conductor entered. It half-deletes the tree, then stops at the protected `<wt>/.git`, and every successful run ends with a `worktree_error`. (2) Unverified: after `/clear` inside the worktree, `ExitWorktree` may be a no-op, so the pending merge's `exit_worktree` never verifies.

**Approach:** Decisions by the human, 2026-10-26: (1) the factory no longer removes worktrees. They are kept silently: no removal attempt, no `worktree_removed`/`worktree_error` in the done report, no mention in the done line. Branches were already kept. (2) No experiment; a small CLI fix (chosen after review showed a skill line alone is blocked by the Stop hook and lacks the run id after `/clear`). `done` on an `exit_worktree` from inside the worktree still refuses and reissues, and its message gives the exact way out: quit, `claude` in the main checkout (absolute path), `/factory resume <run_id>`. `mayStop` lets the turn end while the open `exit_worktree` is a reissue (attempt > 1). The skill says: if ExitWorktree reports no active session, run `done` anyway and relay its message. A session started in the main checkout verifies the step from its cwd and merges.

**Rules:** Event schema `v:1`, no event change. Every fixture and recording folds byte-identical (the done report is CLI output only). No sandbox bypass and no new sandbox rule. Docs that say the CLI removes the worktree are updated in the same change.

</frozen-after-approval>

## Implementation Notes

- Sandbox evidence (2026-10-26): `ExitWorktree(remove)` refuses a worktree entered by `path` ("This session is not the owner…"). After `ExitWorktree(keep)`, `<wt>/.git` and `.git/worktrees/<name>/commondir` stay write-protected for the rest of the session. A worktree the session never entered stays writable. In a new session, the old `factory-sbxcheck` worktree's `commondir` is still protected. A plain `git worktree remove` deletes part of the tree, then fails and leaves it dirty, so a second plain remove refuses.
- Removal: `housekeeping` (src/cli/next.ts) no longer removes the worktree, and its report drops `worktree_removed`/`worktree_error`. `worktreeRemove` is deleted from src/cli/git.ts. The skill's done line, AD-8, AD-15, the spine Housekeeping line and pipeline-stages.md are updated. Five test assertions now expect the worktree to be kept.
- /clear: the `done` refusal for `exit_worktree` from inside (src/cli/done.ts) ends with the way out (main checkout from `dirname(commonDir)`, `/factory resume <run_id>`, end the turn) instead of "run factory next". `mayStop` (src/core/stop.ts) skips an open `exit_worktree` with attempt > 1. The skill's `exit_worktree` line and AD-12 are updated. Tests: the refusal message (pipeline WRAP test) and the stop rule (stop.test.ts).
- No event or schema change. `test/fixtures` unchanged. Full suite, one run: 422 tests, 421 pass, 1 skipped, 0 fail.
- No `tsc` here (the npm cache is root-owned), so the test run is the check.

## Review Triage Log

| # | Finding | Verdict | Route / evidence |
|---|---|---|---|
| 1 | Two more tests (5-1 parallel, 5-2 greenfield) assert the worktree is gone | high | patch: they failed in the first run; now assert it is kept |
| 2 | Acceptance test still checks `worktree list` excludes wt; title says "gone" | low | patch: assertion dropped, title fixed |
| 3 | `leftover.txt` setup only existed to make removal fail | low | patch: removed |
| 4 | Skill line "end the turn" is blocked by the Stop hook while `exit_worktree` is open | medium | patch (human chose the CLI fix): `mayStop` exempts a reissued `exit_worktree` |
| 5 | The trigger relies on ExitWorktree's no-op wording | low | patch by design: the conductor runs `done` anyway; the CLI decides from cwd |
| 6 | After `/clear` the conductor lacks the run id and the main checkout path | medium | patch: the `done` refusal carries both |
| 7 | No test of a second session taking over from the main checkout | low | rejected: holder takeover by `resume` is covered by the 5-1 tests; verification from an outside cwd by the WRAP test |
| 8 | deferred-work.md entries for both items not updated | low | rejected: the workflow never edits old entries |
| 9 | Older done specs still say the CLI removes the worktree | low | rejected: done specs are history |
| 10 | Kept worktrees pile up; tools in the main checkout may crawl them | maybe-false (medium if true) | defer: deferred-work.md entry |
| 11 | Spine Housekeeping line omits the port release | low | rejected: cosmetic, unchanged by this work |
| 12 | Spec has no ACs or matrix | false | a oneshot spec drops those sections by design |

