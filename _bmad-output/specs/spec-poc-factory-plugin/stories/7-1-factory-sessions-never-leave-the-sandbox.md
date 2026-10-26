---
title: 'Factory sessions never leave the sandbox'
type: 'feature'
created: '2026-10-26'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-7-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In dry run 2, after a failed merge the conductor retried a command with `dangerouslyDisableSandbox` on its own and told the human to loosen `/sandbox`. Claude Code's default advice beat the skill's "never improvise", and "loosen your sandbox" is not an ask in `review-policy.md` (finding 5; CAP-10, AD-35).

**Approach:** Apply the approved change in `sprint-change-proposal-2026-10-26.md` section 4.1. In a bound session the PreToolUse guard (AD-31) denies any `Bash` call with `tool_input.dangerouslyDisableSandbox === true`, from the conductor or an agent. The check runs before the path checks, and the deny reason is the proposal's text verbatim. The conductor skill, every agent brief (`brief.ts`) and the README state the rule. The 4.1 contract edits go into `SPEC.md` (Constraints, CAP-10 success), `review-policy.md` (closed-list footer) and the spine (AD-31 guard bullet, AD-35 new rule bullet, inline clause removed). Finding 5 in `dry-run-2-findings.md` is marked as decided. Tests: a bound conductor with the flag `true` is denied, and so is a subagent. With the flag `false` or absent, the existing checks run unchanged. An unbound session is untouched.

</frozen-after-approval>

## Implementation Notes

- `stories.yaml` didn't have 7-1 or 7-2 yet, though the proposal's handoff asked for them. Both were appended verbatim from proposal section 4.4.
- `src/hooks/guard.ts`: `SANDBOX_DENY` (exported for tests) is the proposal's reason text verbatim. The check is the first thing in `decide`'s Bash branch, ahead of the agent-factory deny and the plain-`factory` exemption, so it holds even for a plain conductor `factory` call. Only a real boolean `true` is denied.
- `src/cli/brief.ts`: the rule line sits right after the "Write exactly one file" line, which is the only line every agent brief carries. The conductor's intake brief is unaffected (it is covered by SKILL.md).
- Contract docs: the 4.1 edits went into SPEC.md (Constraints, CAP-10 success), review-policy.md (closed-list footer) and the spine (AD-31 guard bullet, AD-35 new rule bullet, inline clause removed). The 4.2/4.3 doc edits are 7-2's. `dry-run-2-findings.md` records findings 1, 2 and 5 as decided.
- Tests: `test/guard.test.ts` (the `decide` unit) and `test/hooks.test.ts` (end-to-end through the PreToolUse hook: conductor, agent, `false`, unbound).
- Still to check by hand in dry run 3: the deny holds under `bypassPermissions`.
- Review patch: `guard()` now checks the flag before `loadCommands`, so a corrupt run log can't fail the deny open (`decide` keeps the same check for its unit callers).

## Review Triage Log

Blind Hunter, one pass:

- medium · patch: the guard loaded the run state before the flag check, and a throw there exits 0 with no deny. The check now runs first in `guard()`.
- maybe-false (would be medium) · defer: other tools may accept `dangerouslyDisableSandbox`. Only Bash is matched.
- medium · patch: the brief line forbade the bypass but not asking for a sandbox change, so an agent's ESCALATE reason could carry that ask to the human. Clause added.
- false: "line under the wrong heading". That section already holds the non-output rule "never run `factory`", and the agent reads the whole brief.
- medium · patch: the README said "Setup covers what the factory needs" while `allowLocalBinding` is manual. It now says "Setup and the settings above". The matching SPEC wording is deferred.
- false: "cleanup kill needs the sandbox off". The README sends process cleanup to the human's own terminal, outside a factory session.
- low · patch: no test pinned the prompt rules. SKILL.md and brief assertions added.
- false / low rejected: "flag absent untested". Every existing guard test omits the flag. The agent factory-with-flag ordering and the boolean-only check are deliberate (the hook input is JSON with a boolean) and noted above.
- real by design · defer: bound-only guard leaves pre-bind turns unenforced.
- low · defer: the CAP-10 "factory command" wording is narrower than the rule. Approved SPEC text.
- low · patch: `epic-7-context.md` said none of the contract edits were applied. It now says the 7-1 edits are done.
- rejected: leftover `.claude/worktrees/` probe dirs predate this change. They are not staged, because the commit adds named paths only.
- false: "story file not closed". Finalize sets `done`. The dry run 3 check is tracked in the proposal's "Done when" and in the notes above.
