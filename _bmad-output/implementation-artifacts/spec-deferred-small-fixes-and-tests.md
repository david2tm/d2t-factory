---
title: 'Clear five deferred small fixes and tests'
type: 'chore'
created: '2026-10-25'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Five entries in `deferred-work.md` are untested branches or unverified risks: the `factory setup` tmp cleanup when only the rename fails, the `factory check` timeout with a stdout-holding grandchild, the dashboard's no-dist placeholder, SliceCard's inline `reviewing` rule, and the Non-convergence card's dependency list in the pipeline.

**Approach:** Tests plus minimal code changes, with no behaviour change beyond these:
1. Make the rename in `setup` injectable and test that a rename-only failure leaves no tmp file. Removing `rmSync(tmp)` must fail the test.
2. Reproduce the check timeout with a backgrounded `sleep` that inherits stdout and a short timeout. Only if it hangs, spawn detached with output to a file and kill the process group. Otherwise record the result and close the entry.
3. Add a dist-dir override (`FACTORY_DASHBOARD_DIST`) and test the placeholder at `/` and `/replay/<name>`, with other paths returning 404.
4. Move `reviewing` into `lib/model.ts` next to `pendingReviewers`. Test that an IN_REVIEW card with pending rows is not `reviewing`.
5. Add a pipeline test where S1's accepted `package.json` change is not in S2's Non-convergence list, so reverting `next.ts` to the base_sha diff fails it.

Remove each entry from deferred-work.md as it lands. Log new findings there instead of fixing them.

</frozen-after-approval>

## Implementation Notes

- Item 2 reproduced on 2026-10-25 (Node 26.11.1) with sh()'s spawnSync options and a 500 ms timeout. `sleep 8 & echo started` and `sleep 8 & sleep 5` both returned at about 502 ms, so there is no hang and no code change, and the entry is closed. Side findings are logged as new deferred entries. When sh exits 0 but a grandchild holds stdout, spawnSync waits out the full timeout and the check records exit 0 (ETIMEDOUT is ignored). The grandchild also outlives the timeout.
- Item 1: `setup(_args, rename = renameSync)` in `src/cli/setup.ts`. The verb dispatcher passes only `args`. The test in `test/cli.test.ts` calls `setup` in-process with a throwing rename. Mutation check: with the `rmSync(tmp)` line deleted, the test fails because `settings.json.factory-<pid>.tmp` is left behind.
- Item 3: `FACTORY_DASHBOARD_DIST` in `src/store/paths.ts`, plus a no-dist test in `test/dashboard.test.ts`. The test binds a local port, so it was run outside the sandbox.
- Item 4: `reviewersAtWork(card)` in `lib/model.ts`, used by `SliceCard.svelte`, and `dashboard/dist` rebuilt. Mutation check: dropping `|| pendingReviewers(card).length` fails the new test in `test/web-model.test.ts`.
- Item 5: a new test in `test/pipeline.test.ts`. S1's accepted `package.json` change is followed by S2 adding `requirements.txt` and reaching Non-convergence. The test compares the whole reason exactly. Mutation check: with the deps switched to `diffNames(base_sha, HEAD)`, the test fails with `package.json, requirements.txt`.
- Full suite: 362/362 pass with `node --test test/*.test.ts`, including web-build.

## Review Triage Log

- Timeout recorded as pass (check.ts `r.status ?? 124`): medium, real, but older than this change. Deferred: already logged as a new deferred-work entry, per the instruction to log rather than fix.
- `FACTORY_DASHBOARD_DIST` leaking from the developer's shell into test homes: low, real, caused by this change. Patched: `makeHome` now deletes it. The dashboard suite passes with `FACTORY_DASHBOARD_DIST=/nonexistent`.
- A relative `FACTORY_DASHBOARD_DIST` resolves against the server cwd: low. Rejected: the override is test-only, and like the other `FACTORY_*` overrides it expects an absolute path.
- dist only half staged: false. The commit stages the new asset with the deletion.
- AD-16 entry not updated, and the `http.ts` comment: low. Rejected: the entry is still accurate (it needs a data-dir path), and old entries are not edited.
- Spec unfinished, mutation checks unrecorded: addressed here by finalizing the spec and recording the notes above.
- `rename` as an optional positional parameter on a verb: false today, since `main.ts` calls `verb(args)` with one argument. Rejected.
- The pipeline test copies its S1 setup: low, style. Rejected.
- `reviewersAtWork` edge cases (no builder, superseded builder): maybe-false, low. The rule moved over unchanged, and changing it is a behaviour change. Rejected.
- `pendingReviewers` computed twice, and SliceCard's use not tested: low and negligible. Component tests are out of scope (there's no harness). Rejected.
- The no-dist test leaves a temp dir and has no assets-without-index case: low. Every test home here leaks its temp dir the same way, and the 404 path is already covered by `/assets/index.js`. Rejected.

