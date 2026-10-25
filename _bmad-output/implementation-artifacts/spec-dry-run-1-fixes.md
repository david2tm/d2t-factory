---
title: 'Dry run 1 fixes: 1, 6a, 7, 10, 11, 12'
type: 'bugfix'
created: '2026-10-25'
status: 'done'
baseline_commit: '023821b1dde78d0f8e3f6e36991d84691a136f4b'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/dry-run-findings.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Dry run 1 (2026-10-25) showed six faults. (10) The `Non-convergence` escalation label can never parse. (6a) Brownfield SCAFFOLD never runs the contract's `install`. (11) A dev server restart that loses the port to an orphan passes health. (12) App reviewers' screenshots land in the worktree. (7) The scaffold_failure card shows only exit codes. (1) Under the Claude sandbox nothing explains that local binding is off.

**Approach:** Six small fixes, each with a test. The findings table rows 1, 6a, 7, 10, 11 and 12 are the evidence.

## Boundaries & Constraints

**Always:** `install` is a new check, `contract.install`. It runs at SCAFFOLD (brownfield and greenfield) in the worktree and finishes before contract.health and contract.test are issued. A failed install raises scaffold_failure without running them. The existing git.worktree_clean check still fails an install that rewrites a tracked file (such as a lockfile), so "no new dependencies" (escalation 2) holds. A dev server stop that cannot signal the old server throws a CHECK_FAILED refusal naming the pid and how to stop it by hand. It never starts a second server. Card reasons and logs are redacted.

**Never:** Don't change the `factory setup` merge (warn only). Don't pass `--allow-unrestricted-file-access` to Playwright. Don't run install at BUILD or WRAP.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Label with hyphen | `STATUS: ESCALATE` / `Non-convergence: x` | parses, label `Non-convergence` |
| Install fails | `install: "exit 7"` | card reason `contract.install failed (exit 7): <tail>`; no health/test issued |
| Port taken before start | something already answers on the port | refusal CHECK_FAILED "port N already answers…"; no spawn |
| Old server unsignalable | `kill(pid,0)` → EPERM | refusal CHECK_FAILED naming the pid; pid file kept |
| Started pid dead at pass | health OK but our pid gone | exit 1, "the dev server exited; something else answers on port N" |
| Sandbox without binding | settings `sandbox.enabled: true`, no `network.allowLocalBinding: true` | setup output `warnings: [<names the setting>]` |
| Dashboard listen EPERM | new dashboard.log bytes contain `listen EPERM` | dashboard_error names `sandbox.network.allowLocalBinding` |

</frozen-after-approval>

## Code Map

- `src/core/output.ts:78` -- label regex `[A-Za-z ]+` lacks `-`.
- `src/core/events.ts:29` -- `CHECKS`; add `contract.install`.
- `src/core/schedule.ts:79-89` -- `scaffold()` issues SCAFFOLD checks. Use `latestCheckStep` and `runCheck`.
- `src/cli/check.ts` -- `runOne` switch, `sh()`, `testCheck` (pattern for installCheck), `healthCheck`.
- `src/cli/next.ts:198-246` -- `finishScaffold` builds `failures` and the card.
- `src/core/cards.ts:99` -- `scaffoldFailureCard` (reason = failures joined).
- `src/cli/devserver.ts` -- `alive`, `stop`, `killGroup`, `devserverUp`, `devserverDown`.
- `src/cli/brief.ts:41-46` -- the brownfield scaffolder text "Install nothing". Lines 90-102: `reviewerFormat`, the screenshot naming.
- `agents/scaffolder.md` step 2, `agents/reviewer-{ui,ux,a11y}.md` step 3 and the example `observed:` line.
- `.mcp.json` -- `--output-dir ${HOME}/.factory/playwright/<role>`. In @playwright/mcp 0.0.83, an explicit `filename` resolves against the client root (the worktree), not output-dir, and only paths inside output-dir or the workspace are allowed.
- `src/store/paths.ts` -- add `playwrightDir(role)` (homedir-based, to match `.mcp.json`).
- `src/cli/done.ts` -- the reported-step path; copy the app reviewer's screenshots here.
- `src/cli/setup.ts` -- `setup()` return value; `src/cli/dashboard.ts` `ensure()` exit path.
- Tests: `test/output.test.ts`, `test/pipeline.test.ts` (`toSpec` and every SCAFFOLD `c.checks()`; the greenfield reason at line 2492), `test/cli.test.ts` (setup), `test/plugin-config.test.ts`, `test/harness.ts` (`contract()` install is `'true'`).

## Tasks & Acceptance

**Execution:**
- [x] `src/core/output.ts` -- allow `-` in the label; `test/output.test.ts` loops over ESCALATION_LABELS (scaffolder role for `Scaffold failed`).
- [x] `src/core/events.ts`, `src/core/schedule.ts`, `src/cli/check.ts`, `src/cli/next.ts` -- add contract.install. Schedule order: install, then health and test once install is verified and passed. finishScaffold raises the card on a failed install alone, or else waits for all three.
- [x] `src/cli/next.ts` -- each failed check's line gets `: <tail>`. The tail is the last 3 non-empty lines of its redacted log (dropping `$ cmd` and `[exit N]`), joined with ` / `, at most 240 chars. `healthCheck` appends the devserver.log tail to its own log on failure.
- [x] `src/cli/devserver.ts`, `src/cli/check.ts` -- `stop()` throws CHECK_FAILED on EPERM, or when the server is still alive after SIGKILL, and keeps the pid file. Before spawning, `devserverUp` waits up to 2 s for nothing to answer on 127.0.0.1/::1:port, then throws. Health passes only while the started pid is alive.
- [x] `src/cli/brief.ts`, `agents/scaffolder.md` -- brownfield: "the factory runs `install` itself; you install nothing and add no dependency".
- [x] `src/store/paths.ts`, `src/cli/brief.ts`, `agents/reviewer-*.md`, `src/cli/done.ts` -- briefs give the absolute screenshot path `<playwrightDir(role)>/<step_id>-<n>.png` and say to always pass it as the filename. On report, done copies `<step_id>-*.png` from there into the step dir.
- [x] `src/cli/setup.ts`, `src/cli/dashboard.ts` -- setup adds `warnings`. `ensure()` reads the dashboard.log bytes appended since its spawn and, on `listen EPERM`, names the setting.
- [x] tests for each Matrix row; update the SCAFFOLD check expectations in pipeline tests.

**Acceptance Criteria:**
- Given a brownfield run, when SCAFFOLD checks run, then `check_ran` order is contract.install before contract.health and contract.test.
- Given the full suite, when run, then it passes.

## Design Notes

The port proof is two parts. First, nothing answers on the port before the CLI spawns the server. Second, the spawned pid is alive when health passes. Together they mean the answerer is the CLI's own server. That avoids `lsof`, which may be missing or blind under the sandbox.

## Verification

**Commands:**
- `node --test test/*.test.ts` -- expected: all pass (pipeline and dashboard tests need local binding, so run outside the sandbox)

## Implementation Notes

- One change beyond the spec: `devserverDown` can now throw, so `/factory abandon` (`src/cli/decide.ts`) catches it. The decision stands, the answer carries `devserver_error`, and the claims stay held until a later `factory next` finds the server gone.
- `serverAlive` yields to the event loop before probing, so a server this process started and that died during a blocking health command gets reaped and is seen as dead. Without that, `kill(pid, 0)` finds the zombie.
- The greenfield reason at `test/pipeline.test.ts:2492` is unchanged: its command is `false`, which prints nothing, so there is no tail.
- Full suite before review: 373 tests, 372 pass, 1 skipped (needs `ps`). After the review patches: 374 tests, 373 pass, 1 skipped.

## Review Triage Log

- A failed install still offers accept on brownfield (all three layers): medium, real. Accepting verifies SCAFFOLD with health and test never run. Patched: accept also requires a passed install, and the test asserts the commands.
- The brief's "Write nothing else under ~/.factory" contradicts the screenshot path for app reviewers: medium, real. An agent that obeys it may save a bare name into the worktree again. Patched.
- EPERM on a reused pid tells the human to kill an unrelated group: low, real but rare (a stale pid file after a reboot). Patched in the message only: check with `ps` first, otherwise delete the pid file.
- Start commands that background or daemonize now fail health with "something else answers": medium, real. Patched with brief and agent wording (start in the foreground). A process-group probe was rejected: it widens stop and running checks, and the CLI must own the process it stops.
- The health error line is dropped from the card's 3-line tail: low, real. Patched: the error line now comes last.
- The abandon `devserver_error` branch is untested (verification-gap): patched with a pipeline test.
- `answers()` treats EPERM, EACCES or a timeout as free: false. Health's own command connects to the same port, so a blocked connect cannot produce a false pass. A kernel backlog accepts without the app, so a slow accept isn't a real case.
- A repeated CHECK_FAILED refusal loops without a cap: false. The conductor prints an error and ends the turn (skills/factory/SKILL.md), so the human sees each one.
- `releaseTerminal` and housekeeping throw while the server lives: false as a defect. That is the intended loud failure, and the claims are released once the server is gone.
- Two sources for install pass (`output.exit_code` vs `check_ran`): false. Both are written from the same `r.exit_code` in one append (check.ts).
- The lockfile card doesn't name the files: low, an older message. Rejected.
- `serverTail` reads from 0 when the server was already running: low. Rejected.
- No `allowLocalBinding` hint for the dev server: low, outside items 1 and 6 as asked (the card's tail shows the raw `listen EPERM`). Rejected.
- `settingsWarnings` reads only the user settings file: low. The warning names the file it checked, and setup only manages that file. Rejected.
- The Playwright dir grows; finding paths point at the shared dir, not the copies: low, older behaviour. Rejected.
- Race between `waitPortFree` and spawn, or a foreign listener during boot: low, theoretical. Rejected.
- logTail drops program lines starting with `$ ` or splits surrogate pairs; dashboard.log concurrent append or truncation: low, rare. Rejected.
- An in-flight run upgraded mid-SCAFFOLD runs install after health and test: low, negligible window. Rejected.
- The SIGKILL-survivor throw, EPERM via a BUILD restart, greenfield install card, partial screenshot copy are untested: low. Rejected.
