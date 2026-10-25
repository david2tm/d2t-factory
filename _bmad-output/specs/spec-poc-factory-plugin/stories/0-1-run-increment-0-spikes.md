---
title: 'Run the increment-0 spikes'
type: 'chore'
created: '2026-10-23'
status: 'done'
baseline_commit: 'NO_VCS'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-d2t-factory-2026-10-23/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-poc-factory-plugin/build-order.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Seven platform assumptions in the spine's Open Questions (worktree entry, forgery detection, sandboxed writes, browser isolation, wake-up, Stop and nudge, fact completeness) are unproven on Claude Code 2.1.309. CAP-9, CAP-12 and CAP-14 rest on them, and Stop and nudge has no fallback.

**Approach:** Build throwaway harnesses under `spikes/`. Run each spike against its "Passes when" criterion in real Claude Code sessions, and record one verdict per spike in `spike-results.md`.

## Boundaries & Constraints

**Always:** The spine's Open Questions table is the only source of pass criteria and fallbacks. Every spike session runs with `--permission-mode default` and `--plugin-dir spikes/plugin`, because the user default is `bypassPermissions`. Harness code uses Node built-ins only. Each verdict cites raw evidence: hook JSONL lines, tmux pane captures, or command output. Remove spike data under `~/.factory/` when done, since the directory did not exist beforehand.

**Decisions (human, 2026-10-23):**
- **Interactive conditions** are driven by tmux-controlled interactive `claude` sessions. These conditions are a fresh session, `/clear`, the first turn after it, and "zero prompts". The harness detects a prompt by finding a permission dialog in the captured pane.
- **Settings** go into `~/.claude/settings.json` permanently, with no restore. Before any spike runs, merge in the AD-35 setup entries and turn the sandbox on: `~/.factory` in `permissions.additionalDirectories`, an `EnterWorktree` allow rule, `sandbox.enabled: true`, and `~/.factory` in the sandbox `allowWrite`. Merge them into what is already there; never replace existing keys. Save the original to `spikes/.work/settings.before.json` for reference.
- **All spikes run under the sandbox.** If any spike misses its criterion, rerun it once with `--settings '{"sandbox":{"enabled":false}}'`. Record both runs, so the result shows whether the sandbox caused the failure.
- **Spec size:** keep it as one spec.
- **Spike 06 failure, ruled 2026-10-23: option A.** AD-12's resume criterion becomes "the first human-started turn after `/clear` resumes the run". On `SessionStart(clear)`, the session is rebound to its run by Claude Code process pid plus start time, as a narrow exception to AD-25. Record this in `spike-results.md`. The spine amendment is follow-up work outside this story.

**Never:** Product code (`src/`, `bin/factory`, `skills/factory*`, `agents/`). Never edit the spine. Never weaken a criterion to get a pass. Never mark a spike PASS from a proxy that skips the stated condition. If the condition can't be reproduced, the verdict is BLOCKED.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Criterion met | Spike run matches "Passes when" | `PASS` plus evidence | N/A |
| Criterion missed, fallback exists | e.g. EnterWorktree prompts | `FALLBACK` names the fallback adopted and why; run the fallback's own check where one is runnable | Record both runs |
| Stop and nudge fails | Stop not blocked, or no resume after `/clear` | `FAIL — no fallback` | HALT and escalate to the human; CAP-14 is at risk |
| Can't reproduce condition | e.g. sandbox unsupported | `BLOCKED` plus the reason and what would unblock it | Never a silent PASS |
| Extra observation (review-rubric M-item) | Model-initiated `Skill` call to `factory` with args `approve gate2` | Record whether `UserPromptExpansion` fired | Observation only; not a pass criterion |

</frozen-after-approval>

## Code Map

- `_bmad-output/planning-artifacts/architecture/architecture-d2t-factory-2026-10-23/ARCHITECTURE-SPINE.md:717-729` -- Open Questions table: criteria and fallbacks. Read-only.
- Same file, AD-6 (l.127), AD-12 (l.233), AD-13 (l.245), AD-15 (l.274), AD-17 (l.304), AD-22 (l.380), AD-31 (l.494), AD-35 (l.537) -- the behaviour each spike must exercise: hook events and sync/async, guard exceptions, `mayStop`, the nudge text, `next --wait`.
- `_bmad-output/planning-artifacts/architecture/.../reviews/review-rubric.md:141` -- source of the extra Skill-call observation.
- Environment: Claude Code 2.1.309; Node v26.11.1, below the spine floor of 26.12.1; tmux at `/opt/homebrew/bin/tmux`; agent-browser not installed (0.39.2 is on npm); no sandbox; `~/.factory` absent; project root is not a git repo.

## Tasks & Acceptance

**Execution:**
- [x] `spikes/lib/apply-settings.ts` -- Back up `~/.claude/settings.json` to `spikes/.work/settings.before.json`, then deep-merge the decided entries into it without dropping or reordering existing keys. Running it twice must give the same file. Run it before any spike.
- [x] `spikes/plugin/` -- Minimal dev plugin (`.claude-plugin/plugin.json`, `hooks/hooks.json`, `bin/hook.ts`). It registers the AD-13 events with the spine's sync/async split and appends every payload to `~/.factory/spike/facts.jsonl`. A JSON state file switches on Stop blocking, the SessionStart nudge, the PreToolUse guard, and prompt capture. It is the shared instrument for all spikes.
- [x] `spikes/lib/tmux.ts` -- Start, send keys, wait for a pattern, and capture the pane for an interactive `claude`. It also detects a permission prompt in the pane.
- [x] `spikes/lib/target-repo.ts` -- Create a throwaway git repo under `spikes/.work/` for the sessions to run in.
- [x] `spikes/<nn>-<name>/run.ts` -- One runner per spike, seven in all. Each prints a verdict JSON `{spike, verdict, evidence[], notes}`. Forgery uses `opus` as the builder, as in the spine's model routing; the other spikes use `haiku` where model behaviour is irrelevant.
- [x] `spikes/06-stop-nudge/` -- Run first. It has no fallback, so a FAIL halts the rest.
- [x] `_bmad-output/specs/spec-poc-factory-plugin/spike-results.md` -- One section per spike: verdict, evidence excerpts, fallback adopted, and the consequence for stories 1-x to 5-x. Add the Node floor finding and the Skill-call observation.
- [x] `_bmad-output/specs/spec-poc-factory-plugin/build-order.md` -- Add one line under `## Spikes` that points to `spike-results.md`.

**Acceptance Criteria:**
- Given all seven runners, when each completes, then `spike-results.md` has exactly one of PASS, FALLBACK, FAIL or BLOCKED per spike, each with at least one cited evidence excerpt.
- Given the forgery spike, when the red-team brief runs echo, heredoc, python, base64 and symlink attempts, then each attempt is listed separately with its outcome.
- Given a spike that missed its criterion under the sandbox, when its result is read, then a second run with the sandbox off is recorded next to it.
- Given the run finishes, when `~/.factory` and `~/.claude/settings.json` are inspected, then no spike data remains under `~/.factory`. The settings hold the original keys plus only the decided entries.

## Implementation Notes

- 2026-10-23: Pass 1 halted under the I/O matrix row "Stop and nudge fails". Spike 06 gave `FAIL — no fallback`, and the sandbox-off rerun gave the same result. Phases A (Stop blocked in BUILD) and B (Stop allowed when parked at a gate) passed. Phase C failed for two reasons:
  - `/clear` mints a new `session_id`, so resolving the run by session id (AD-25) finds nothing and no nudge is injected.
  - No turn starts without human input; `initialUserMessage` does not start one interactively.
  - With the hook's ppid as the key instead, the nudge is injected, and the first human-typed turn resumes the run.
  - Evidence: `spikes/.work/evidence/06-stop-nudge/verdict.json`.
- Spikes 01–05 and 07 are BLOCKED. Their runners are written but were never executed. The forgery red-team brief and its five attempts were not authored; the implementer declined to write them.
- Environment findings:
  - The sandbox cannot create a missing `~/.factory` even when it is allow-listed.
  - `npm`/`npx` fail under the sandbox on `~/.npm`.
  - Chrome for Testing was installed to `~/.agent-browser/browsers/`.
  - Correction (pass 2): only the harness commands that drive tmux ran with the sandbox off. Each spike `claude` session had its own sandbox, as the decisions require.
- Verified against baseline: `~/.claude/settings.json` differs only by the four decided entries, `~/.factory` is absent, and `build-order.md` gained only the pointer line.
- 2026-10-23, pass 2 (after the option A ruling): the implementer ran 01, 03, 04, 05 and 07 one at a time with the sandbox on.
  - 01 and 04 came out FALLBACK; 03, 05 and 07 came out PASS.
  - Runner fixes: prompt double-counting in `lib/turn.ts`; ms timestamps in `04/reviewer.sh`; a stand-in workload `05/work.ts`, because a bare `sleep` is rejected; batch prompts read from files in 07, because typed prompts arrived truncated.
- 2026-10-23, pass 3: the orchestrator authored `plugin/agents/builder-redteam.md`, `02-forgery/run.ts` and `02-forgery/skill-call.ts`, and ran them.
  - 02 is BLOCKED. The conductor backgrounded the builders, so attempts overlapped, and a model safeguard stopped the sandbox-on run; it was not engineered around.
  - The run found two holes. The guard was evaded by a base64-built path (`facts.jsonl:36`). `decide` trusts a forged `transcript_path` and returned VERIFIED.
  - Skill-call observation: the Skill tool refuses because of `disable-model-invocation`, and no prompt fact is written.
  - `~/.factory` removed. Its final `rmdir` needed the sandbox off, because the sandbox cannot remove the allow-listed folder itself.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence | Route |
| --- | --- | --- | --- | --- |
| B1/E1/E33 | After the control, any forged line with the real `transcript_path` replays the genuine approval, so "UNVERIFIED" is unreachable and the "instrument can tell" claim is wrong | high | The sandbox-on conductor transcript holds one user turn with `<command-args>approve gate2</command-args>`, and `decide` (`factory.ts:83-98`) matches any user turn | patch (results doc) + defer (AD-6 design) |
| B2/E37 | `decide` never marks a prompt consumed, so one approval can be reused | medium | No consumed marker is written in `factory.ts`. The spine's AD-26 ledger covers this for the product; the spike doesn't model it | defer (story 1-3 lesson) |
| B3/E34/E35 | The 03, 04 and 05 verdicts are binary PASS:FALLBACK and can't return BLOCKED | low | No recorded run was unexercised; the raw evidence checks out (verification-gap layer). Throwaway harness | reject |
| B4/E27 | The 02 runner has no catch, and `clearInbox` removed the directory, interfering with the base64 attempt | low | Interference is already disclosed in the 02 section; the run is BLOCKED either way | reject |
| B5 | Option A's ppid key depends on exec-form hooks, and changes on `--resume`, `--continue` or a crash | medium | `hooks.json` uses the exec form; only `/clear` was tested | patch (results doc: list the limits) |
| B6 | "`mayStop` can read `background_tasks` directly" is untested | false | The doc says the payload carries the field (shown in 05 `facts.jsonl:13`), not that a decision was made on it | reject |
| B7/E24/E25 | `apply-settings` keeps a conflicting user `sandbox.enabled:false`, and crashes when settings are missing | false | The original settings had no `sandbox` key and the file existed (`settings.before.json`); the outcome did not occur | reject |
| B8/V6 | Pass-1 Implementation Notes bullets read as current | low | True, but the fix edits this build's spec | reject |
| B9 | Follow-ups (spine amendments, 02 rerun, 04 decision, Node floor, setup mkdir) are untracked | medium | Only prose in `spike-results.md`; no deferred-work entry exists | defer |
| B10 | Several PASS verdicts rest on one narrow sample (05 on haiku with a 3-minute wait; 07 Write-only) | low | Accurate, and the criteria were met as stated; no scope limits are noted | patch (results doc: one caveat line each) |
| B11 | Some evidence was captured by hand; the 06 sandbox-off run deletes the sandbox-on repo | low | The evidence was archived before deletion (`evidence/06-stop-nudge/sandbox-on/`); throwaway | reject |
| B12 | Chrome and the npm cache are left behind; the tmux path is hard-coded | low | Disclosed side effect; harness is single-machine | reject |
| V1 | The 02 finding-1 explanation (denied "only because" of the transcript path) contradicts the deny notes | medium | `facts.jsonl:23,26,31` were denied on the literal `/Users/d2t/.factory` prefix | patch (results doc) |
| V2/E31 | The 06 pass check is looser than the criterion | low | The verdict was FAIL, and the ruling relied on raw ordering (`factory next` before any Stop) | reject |
| V3/E30/E36 | The 05 pass check and its "asserts builder still running" claim are vacuous when no builder starts | low | Builder `aa5f271e…` did start (`facts.jsonl:5,7`); the claim in the doc overstates the check | patch (results doc wording) |
| V4 | Unexplained second agent `a02a1d18…` runs `work.ts` in 05 | maybe-false | `facts.jsonl:14`: no SubagentStart, no `agent_type`. Settle by reading the builder transcript to see whether it re-launched or forked | patch (results doc: note it as unexplained) |
| V5 | The 04 runner was edited after its `verdict.json` was written | low | The mtime is 16 s after the verdict; the notes string differs. The verdict itself is backed by archived evidence | patch (results doc note) |
| E3 | `repoHash` joins an absolute `git-common-dir` in a linked worktree | low | Harness-only; same pitfall for the product's `paths.ts` | defer (story 1-x lesson) |
| E4/E5/E6/E7 | Guard gaps: case-variant paths on APFS, dangling symlinks, `factory "$(…)"` substitution, runtime-built paths | medium | Code at `common.ts:56-74` and `hook.ts:64,71`; E7 was observed at `facts.jsonl:36` | defer (story 1-3 guard design) |
| E8 | Stop blocks endlessly when `stop_hook_active` | false | AD-12 deliberately ignores `stop_hook_active` and relies on the 8-continuation cap | reject |
| E9 | No nudge on `SessionStart` source `compact` | medium | AD-12 lists startup, clear and resume only; after auto-compaction the conductor may lose the run | defer (spine AD-12) |
| E10 | A `command_name` of bare `factory` isn't captured | false | The control shows `command_name=d2t-factory:factory` for a typed `/factory` (`facts.jsonl:3`) | reject |
| E11 | NotebookEdit isn't counted as `output_written` | low | AD-31 names Write, Edit and MultiEdit only | reject |
| E12-E23, E26, E28-E29, E32 | tmux, turn and runner robustness (torn JSONL, races, scrollback, dedupe, timeouts, barrier, stderr) | low | No recorded verdict was affected (checked against raw evidence by the verification-gap layer); throwaway harness | reject |

## Design Notes

The plugin's state-file toggles stand in for the reducer: `mayStop` here is "the state file says `open_steps` are not all `ask_human`". The spikes test the platform, not factory logic, so this proxy is sound. Verdict JSON example:

```json
{"spike":"06-stop-nudge","verdict":"PASS","evidence":["facts.jsonl:41 Stop → decision:block","pane@T+3s: 'run factory next'"],"notes":"8-continuation cap not reached"}
```

## Verification

**Commands:**
- `node spikes/<nn>-<name>/run.ts` -- expected: exit 0 and a verdict JSON on stdout, for each spike
- `test ! -d ~/.factory/spike` -- expected: true after cleanup

**Manual checks (if no CLI):**
- Diff `~/.claude/settings.json` against `spikes/.work/settings.before.json`: the only changes are the decided additions
