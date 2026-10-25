---
title: 'Minimum truth-slice hooks'
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

**Problem:** Nothing observes the session yet. No hook writes `/factory` prompts to the inbox, so `decide` cannot work for real. Stop never blocks, the `/clear` rebind and the SessionStart nudge don't exist, nothing guards writes, and no facts are written. Real evidence also shows `matchTurn` rejects every genuine typed `/factory …` decision: the transcript stores `<command-name>/d2t-factory:factory</command-name>`, but `prompt_text` is `/factory approve gate2`.

**Approach:** Add exec-form plugin hooks (`bin/factory hook <event>` → `src/hooks/`) for AD-6/12/13/14/25/26/31: prompt capture, the SessionStart nudge plus `/clear` rebind, the Stop block, the PreToolUse guard and the async fact hooks. Add the pure `mayStop` and `redact` to core, fix `matchTurn`, and have the CLI adopt a hook rebind as a `session_bound` command.

## Boundaries & Constraints

**Always:** Node built-ins only; AD-2 layering (hooks import only core/store). Hooks exit 0 and log failures to `hook-errors.log`. The two exceptions are Stop `{"decision":"block"}` and the PreToolUse deny `hookSpecificOutput`, both emitted as JSON on exit 0, the form spike 06 proved. Every hook does nothing if `factoryHome()` is missing. Unbound sessions get no output and no facts; prompt capture and `plugin-env.json` are the exceptions. Facts are validated, `actor: "hook"`, redacted, whitelisted (AD-14), and written in one append. No git in hooks. `events.ts` changes are additive; fixture snapshots stay byte-identical. Paths come only from `paths.ts`.

**Never:** Hooks never write `commands.jsonl`. No conductor playbook: the skill is frontmatter plus one stub line. No AD-7 verifier, `step_verified` from facts, or orphan reissue (all 1-4). No `factory record`. No `WorktreeCreate`/`WorktreeRemove` hooks.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Capture | `UserPromptSubmit` prompt `/factory x` or `/d2t-factory:factory x`; `UserPromptExpansion` `command_name` `d2t-factory:factory` | `prompt_text` / `human_prompt` appended to `inbox/<session>.jsonl`, bound or not | Other prompts, including `<task-notification>`, write nothing |
| Real decide | Facts as above; transcript turn `<command-name>/d2t-factory:factory</command-name>` + args | `matchTurn` true: the name is in {factory, d2t-factory:factory} and the redacted turn args equal the prompt args | Another `promptId`, session or origin, or different args → false |
| Stop | Holder session, non-terminal run | Allowed iff every open step is `ask_human`, or claimed and matched by a running `background_tasks` entry (subagent `agent_type` = step agent; a shell for `run_check`) | Otherwise block, whatever `stop_hook_active` says. Unbound, non-holder or terminal → silent |
| Nudge | Bound holder; SessionStart source startup/clear/resume/compact | `additionalContext` names run, stage and "run `factory next --session <id>`"; writes `session_started` fact | Terminal run → no nudge |
| Rebind | SessionStart `clear`, unbound; exactly one session file whose `claude_pid` and `claude_start` equal ours and whose session holds a live run | Writes the new session file, deletes the old one, and writes `session_started{source:'clear', supersedes}`. The next holder verb from the new session appends `session_bound{supersedes, rebind_fact_id}` and proceeds | Start key mismatch (pid reuse), a null key, or ≠1 match → no rebind; the human types `/factory resume` |
| Guard | Bound session; Write/Edit/MultiEdit/NotebookEdit path, or Bash tokens, resolving under `~/.factory/` or `~/.claude/projects/` | Deny, except inside `artifacts/steps/<id>/` of a step claimed in the bound run, or a conductor (no `agent_id`) `factory …` that is one simple command with no operators, redirections or `$(`/backtick/`<(` anywhere, even in double quotes | `factory` from a subagent → deny. Case-folded on darwin; deepest-existing-ancestor realpath plus the leaf `readlink` |
| Facts | Bound session; PostToolUse / Failure / SubagentStart / Stop / SessionEnd | `output_written{path, first_line≤200}` iff Write/Edit/MultiEdit realpath under `runs/<run>/artifacts/`, else `tool_succeeded`; `tool_failed.exit_code` from `/^Exit code (\d+)/` or null; `subagent_*`; `session_ended` → `facts/<session>-<agent_id\|main>.jsonl` | — |

</frozen-after-approval>

## Code Map

- `src/cli/bootstrap.mjs`, `bin/factory` -- the shim dispatches `hook` to a new `src/hooks/bootstrap.mjs` (floor check → log + exit 0), because cli→hooks imports are banned (`test/layers.test.ts`).
- `src/store/sessions.ts` `claudeProcess()` -- `ps` is EPERM under the sandbox, so `claude_pid` is null today. Replace it with an identity from `CLAUDE_PID` (set for both hooks and Bash) and `sock:<birthtime ISO>` of `CLAUDE_CODE_MESSAGING_SOCKET` when its basename is `<pid>.sock`, else `ps:<lstart>`, else null. This session's socket birthtime (05:29:07Z) predates its `/clear` and stayed the same after it.
- `src/core/decision.ts` `matchTurn`/`turnText` -- compare the turn's (name, args), not the rebuilt string. Ordering evidence: UserPromptSubmit (.482) → Expansion (.567) → transcript turn (.584), all before any model tool call, so 1-2's "incomplete group" deferral is moot.
- `src/core/events.ts` -- facts require `actor: 'hook'`; optional `session_started.supersedes`, `session_bound.rebind_fact_id`.
- `src/store/load-run.ts` -- add a commands-only read for the Stop and guard hot path.
- `src/cli/resolve.ts` `requireHolder` and its callers `next`/`claim`/`done`/`status` -- the rebind adoption, under the run lock.
- `src/cli/commit.ts` `requireSetup` -- needs `plugin-env.json`, which SessionStart now writes: `{v:1, plugin_root, plugin_data, dashboard_port, written_at}` (`CLAUDE_PLUGIN_OPTION_DASHBOARD_PORT` else 4870).
- `spikes/plugin/bin/hook.ts`, `common.ts` -- prototype for payload fields, `realish`, the guard and `mayStop`; borrow, don't import.

## Tasks & Acceptance

**Execution:**
- [x] `src/core/redact.ts` -- `redact(value, extra[])`: deep, idempotent `[REDACTED]` for PEM private keys, `AKIA…`, `gh[pousr]_…`, `github_pat_…`, `sk-…`, `xox[abprs]-…`, `Bearer <20+>`, plus the `extra` values.
- [x] `src/core/stop.ts` -- `mayStop(state, background_tasks)` per the matrix.
- [x] `src/core/decision.ts`, `src/core/events.ts` -- the matchTurn fix and the additive fields above.
- [x] `src/store/{paths,sessions,load-run}.ts` -- `redactFile`, the identity, `findByIdentity`, and the commands-only load.
- [x] `src/hooks/{bootstrap.mjs,main.ts,io.ts,prompt.ts,session.ts,stop.ts,guard.ts,facts.ts}` + `bin/factory` -- one module per concern. `guard.ts` exports a pure shell tokenizer/classifier.
- [x] `hooks/hooks.json` -- exec-form `${CLAUDE_PLUGIN_ROOT}/bin/factory ["hook","<Event>"]`. Sync and async sets per AD-13. Expansion matcher `^d2t-factory:factory$`; PreToolUse matcher `^(Write|Edit|MultiEdit|NotebookEdit|Bash)$`.
- [x] `skills/factory/SKILL.md` -- `name: factory`, `disable-model-invocation: true`. Body: run `factory decide --session ${CLAUDE_SESSION_ID}` and show the JSON (1-4 replaces it).
- [x] `src/cli/resolve.ts` + holder verbs -- adopt the rebind.
- [x] `test/{redact,stop,guard,hooks}.test.ts`, plus `decision.test.ts` cases -- units, and one end-to-end per matrix row piping payload JSON into `bin/factory hook <Event>` with a temp `FACTORY_HOME`. Includes the pid-reuse case (same pid, other start key → no rebind) and a capture → `decide` round trip.

**Acceptance Criteria:**
- Given setup, when hook-captured `/factory add login` → `start` → `/clear` rebind → `next` from the new session → hook-captured `/factory approve intake` → `decide` runs with a real-format transcript, then the run is ORIENT, the holder is the new session, and every inbox and fact line passes `validateEvent`.
- Given the repo, when Verification runs, then all tests pass, tsc reports 0 errors, and the fixture shasums are unchanged.

## Design Notes

AD-25 says the rebind hook "appends `session_bound` to its facts", but facts never change state (AD-4). So the hook writes a `session_started{supersedes}` fact, and the CLI turns it into the command. It adopts only when the caller's session file names the run and the superseded session is `state.holder`. A vacuous `mayStop` (no open steps) allows stopping, as the spine says. Redacting the turn args before comparing keeps a secret in a typed prompt from failing the match.

## Verification

**Commands:**
- `node --test test/` -- expected: all pass.
- `npm i --prefix "$TMPDIR/tsc" --cache "$TMPDIR/npm-cache" typescript@7.0.2 @types/node@22 && "$TMPDIR/tsc/node_modules/.bin/tsc" -p tsconfig.json --typeRoots "$TMPDIR/tsc/node_modules/@types"` -- expected: exit 0.
- `shasum test/fixtures/*.state.json` before/after -- expected: identical.

**Manual checks (if no CLI):**
- In `claude --plugin-dir .`: typing `/factory approve intake` puts two inbox lines in place and `decide` passes; after `/clear`, the next `factory next` succeeds.

## Implementation Notes

- Verification: `node --test test/` 114 pass, 0 fail (Node 26.11.1); tsc 7.0.2 exit 0; `test/fixtures/*.state.json` shasums identical (5df3b831…, 150c88c0…, 3be7b5d6…). Mutation spot-checks: ignoring the start key, skipping the adoption fact check, matching any subagent in `mayStop`, and restoring the old string-rebuild `matchTurn` each fail a test. The manual `claude --plugin-dir .` check was not run (no interactive session here).
- New files: `src/core/{redact,stop}.ts`; `src/hooks/{bootstrap.mjs,main.ts,io.ts,prompt.ts,session.ts,stop.ts,guard.ts,facts.ts}`; `skills/factory/SKILL.md`; tests `test/{redact,stop,guard,hooks}.test.ts`. `bin/factory` dispatches `hook` to `src/hooks/bootstrap.mjs`, and exits 0 early when the factory home or Node is missing. `src/cli/bootstrap.mjs` is unchanged.
- Additive: `events.ts` facts require `actor: 'hook'` (`FACT_ACTOR`), plus optional `session_started.supersedes` and `session_bound.rebind_fact_id`. `paths.ts` adds `redactFile`, `realish` and `isUnder` (case-folded on darwin). `load-run.ts` adds `loadCommands` and `readRedactValues` (`redact.json` as an array of strings or `{values: [...]}`). `sessions.ts` replaces `claudeProcess` with `claudeIdentity`, and adds `findByIdentity`, `writePluginEnv` and the optional `supersedes`/`rebind_fact_id` binding fields.
- `matchTurn` compares (name, args): the name is in {factory, d2t-factory:factory}, and the args are trimmed and redacted with the bound run's `redact.json` values, which `newestPrompt` now passes. Fixture check: the real 2.1.309 turn `<command-name>/d2t-factory:factory</command-name>` for a typed `/factory approve gate2`.
- Interpretations: (1) Inbox lines carry `run: 'inbox'` (`INBOX_RUN`), so every line passes `validateEvent` as written; they predate binding. (2) A pending rebind counts as the holder for the nudge, Stop and the next rebind, so two `/clear`s with no factory call in between still chain. The rebind's `supersedes` is the run's `state.holder`, which is the old file's session except in that chained case. (3) Rebind order: the fact is written first, then the new session file (with `supersedes` and `rebind_fact_id`), then the old file is deleted. The CLI adopts only if that fact exists in the run's facts with matching session, `source: 'clear'` and `supersedes`, so a hand-written session file gets `NOT_HOLDER`. `status` takes the lock only when its session file carries a pending rebind. (4) The guard checks every Bash word, and each piece of a word split on `= : , ; | & < > ( ) quotes $`, that has a slash or a leading `~`/dot, plus every redirection target. It denies reads through Bash as well as writes (a tripwire, as in the spike). Write tools resolve relative paths against the payload `cwd`. (5) The exemption also refuses a `$(`, backtick or `<(`/`>(` inside single quotes, which is stricter than the shell needs. (6) `output_written.first_line` is read from disk after the write.
- Risks: `CLAUDE_PID` in hook processes is taken from the spec, not observed in this session. If it is absent there, there is no key and no rebind, and the human types `/factory resume`. Steps claimed by the superseded session stay `claimed_by` it after adoption, so `done` from the new session is `CLAIM_TAKEN` (orphan reissue is 1-4).

## Spec Change Log

## Review Triage Log

Pass 1 (2026-10-24): blind-hunter (B), edge-case-hunter (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| E1 | A `#` comment stops tokenizing, so later lines of a multi-line Bash command are never path-checked | medium | `guard.ts:56` `break`s out of the whole loop on `#`; `# note\necho x > ~/.factory/inbox/s` is allowed | patch: skip to the next newline |
| E2 | A path glued to a short flag (`-o/abs/.factory/x`) resolves under cwd and passes | low | `pathCandidates` resolves `-o/abs/…` against cwd; the fix is one more candidate piece | patch: also try the word minus a leading `-X` |
| B13/E11 | `turnText` is dead in `src/` and its `!` assertion throws on an unclosed `<command-name>` | low | Only `test/decision.test.ts` calls it after `matchTurn` moved to `turnCommand` | patch: delete it and its test |
| V1 | `decide` with a run `redact.json` value in the typed prompt is untested end to end | medium (pre-verified) | Dropping `extra` in `cli/prompt.ts` keeps all tests green | patch: test |
| V2 | Stop block and compact nudge for a pending-rebind session are untested | medium (pre-verified) | Replacing `holds()` with `holder === session` in `hooks/stop.ts` keeps all tests green | patch: test |
| V3 | `redact.json` object form `{values}` is untested | medium (pre-verified) | Deleting that branch keeps all tests green | patch: test |
| V4 | `claudeIdentity`'s `ps:` fallback never runs | medium (pre-verified) | Every test world sets the socket env | patch: test, skipped when `ps` is denied |
| B3/E9 | `redact.json` or the binding changing between capture and `decide` makes a genuine prompt look forged | low | Capture and `decide` happen in one human turn; `redact.json` is written at SCAFFOLD (1-4), not mid-turn; an unbound capture is checked with `[]` on both sides | reject |
| E10 | An extra value spanning `/factory` in `prompt_text` drops the name | low | Needs a secret equal to `factory …`; implausible | reject |
| E8 | An extra value that is a substring of `[REDACTED]` corrupts a marker inserted in the same pass | low | Values are secrets from gitignored files, never `RED`-like fragments; fix re-splits per replacement | reject |
| B11 | Redaction patterns miss Stripe, JWT, userinfo and other formats | low | The spec fixes the pattern list; adding formats is an enhancement | reject |
| B5/E18 | A claimed `run_check` is carried by any running shell; a spawn by any same-type subagent | low | Matches AD-12's rule ("a d2t-factory:* entry or a background shell"); no `run_check` steps exist before 1-4 | reject |
| E17 | Background statuses other than `running` (pending/starting) block | low | Spike 05 recorded only `running`; a block only makes the conductor call `next` | reject |
| B4 | Stop can block forever because `stop_hook_active` is ignored | false | AD-12: "whatever `stop_hook_active` says. Claude Code's 8-continuation cap is the backstop" | reject |
| E6 | The guard fails open when it throws | false | AD-13: "Exceptions exit 0 and append to hook-errors.log"; the guard is a tripwire (AD-31) | reject |
| B6 | Plugin root and `settings.json` aren't protected | false | AD-31 names exactly `~/.factory/` and `~/.claude/projects/` | reject |
| B7/E3/E4/E5 | Guard evasion via other variables, `cd`, globs, `$'…'`, `bash -c`/`env` wrappers | low | AD-31: "a tripwire, not a boundary"; base64 already known to evade; real protection is AD-6's transcript check | reject |
| E7/B8 | An unbound session or hand-edited file forges a rebind | low | An adversary running as the user is outside the AD-31 threat model; agents run in the bound session, where the guard applies | reject |
| E12/B12 | `status` now locks and writes | false | Spec Tasks: holder verbs including `status` adopt the rebind; it locks only when a pending rebind exists | reject |
| E13 | Adoption commits even if the verb then fails | false | The rebind is legitimate on its own; nothing downstream depends on the verb succeeding | reject |
| E14 | Old session's async `session_ended` can be dropped after the rebind deletes its file | low | A display-only fact; the fix adds a fallback lookup | reject |
| E15 | A crash between writing the new file and deleting the old one blocks later rebinds | low | Needs a crash in a two-syscall window; adoption makes the old file stop matching `holds` | reject |
| E16 | CLI and hook may compute the start key from different sources | low | Both prefer the socket, and both envs carry it (spike hook env and this session's Bash env); a mismatch only degrades to `/factory resume` | reject |
| E19 | A Node prerelease suffix makes the floor check NaN | low | Release builds have no suffix; copies the unchanged CLI bootstrap | reject |
| B1 | Node < 20.11 rejects `--disable-warning`, so the hook exits non-zero | low | `factory setup` can't run on such a Node, so the factory home never exists and the shim exits 0 first | reject |
| B2 | Nothing writes `redact.json` | false | AD-14: the CLI writes it when copying gitignored files into the worktree (1-4); 1-3 only reads it | reject |
| B9 | `output_written` misses NotebookEdit and Bash writes | false | AD-31 defines it for `Write\|Edit\|MultiEdit` only | reject |
| B10 | Fact sizes are uncapped | false | `appendLine` → `serialize` truncates every line to 32 KiB (AD-28) | reject |
| B14 | Missing tests: adoption crash window, unredacted bootstrap log, old non-hook facts | low | Crash windows need fault injection; the bootstrap logs only load errors; no facts were written before 1-3 | reject |
