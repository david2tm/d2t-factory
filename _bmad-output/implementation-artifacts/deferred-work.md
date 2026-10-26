- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/0-1-run-increment-0-spikes.md`
  summary: [dry run 3] (optional) Rerun spike 02 (forgery) cleanly, with five non-overlapping attempts and a builder held in the foreground.
  evidence: The run was invalid because the conductor backgrounded the builders and a model safeguard stopped the sandbox-on run. The python and symlink attempts were never exercised. A clean run needs `claude --agent` or a foreground-only conductor, and must not try to get around safeguards.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/1-5-build-review-wrap-and-record.md`
  summary: [dry run 3] Merge a run on a husky + commitlint brownfield repo, hooks on, and check that the final `--no-ff` merge passes.
  evidence: Decided in batch 2: the merge message is git's default `Merge branch 'factory/<run>'` (commitlint's default ignore), the task is in the body, hooks stay on, and `--no-verify` is never passed. A temp-repo commit-msg hook test passes, but a real husky + commitlint setup (and a `pre-merge-commit` hook) has not been tried.
- source_spec: `_bmad-output/specs/spec-poc-factory-plugin/stories/4-1-replay-engine-for-single-run-recordings.md`
  summary: [dry run 3] Make a real interactive increment 1–3 recording (never `claude -p`) and add it to `test/fixtures/recordings/` with its `buildTimeline` snapshot as a regression fixture.
  evidence: 4-1 ships synthetic fixture recordings only (decided 2026-10-25); no real recording existed under `~/.factory/recordings/` when it was planned.
- source_spec: `_bmad-output/implementation-artifacts/spec-dry-run-2-wrap-merge-fix.md`
  summary: [dry run 3] Unverified (high if true): after `/clear` inside the worktree, `ExitWorktree` may be a no-op, so the pending merge's `exit_worktree` never verifies and the run reaches the reissue cap instead of merging.
  evidence: ExitWorktree's docs say it only acts on worktrees entered with EnterWorktree "in this session", and the session's cwd survives `/clear` (AD-15). Settle it in dry run 3: `/clear` inside the worktree before `/factory merge`, then check that ExitWorktree returns the session to the main checkout. Before this change the same gap only skipped housekeeping; now it blocks the merge.
- source_spec: `_bmad-output/implementation-artifacts/spec-dry-run-2-worktree-exit-and-removal.md`
  summary: [dry run 3] Check whether Jest, ESLint or `tsc` run in the target's main checkout crawl the kept run worktrees under `<repo>/.claude/worktrees/` and find duplicate modules or tests.
  evidence: Kept worktrees hold installs and copied gitignored files, and `.git/info/exclude` hides them from git only (unverified; settle on a brownfield repo with Jest after two runs). `factory prune` (batch 2) prints the cleanup commands for the human's own terminal.
