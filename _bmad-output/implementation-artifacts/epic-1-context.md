# Epic 1 Context: Walking Skeleton

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Ship the thinnest end-to-end d2t-factory plugin: one brownfield run in one worktree, stub intake → RECON → SCAFFOLD → spec (gate 1) → single-slice plan (gate 2) → builder → reviewer-code → human-approved merge at WRAP, then `factory record`. It carries the minimum truth slice (pure reducer, `factory` CLI, prompt/Stop/SessionStart/guard/fact hooks) because every gate and merge depends on hook-observed human commands. Must be demoable on a real brownfield repo. No dashboard yet.

## Stories

- Story 1.1: Plugin skeleton and functional core
- Story 1.2: Factory CLI driver
- Story 1.3: Minimum truth-slice hooks
- Story 1.4: Brownfield front half of the pipeline
- Story 1.5: Build, review, wrap, and record

## Requirements & Constraints

- The LLM's say-so never advances state: illegal transitions, and gate passes lacking evidence or a human-typed `/factory` command, are rejected; unbound sessions' events are dropped.
- The conductor may end a turn only when awaiting the human, waiting on background work, or terminal.
- `/factory [task]` starts; bare `/factory` resumes after `/clear` at the same stage without redoing work (worktree's run → single live run → list).
- Stub intake still requires `/factory approve intake`; single-slice plan still requires `/factory approve gate2`, so no recording skips those decisions.
- Brownfield SCAFFOLD: no tracked file in the target repo changes; health check passes or the human is paged before code is written.
- Spec fits one screen; every acceptance criterion has a command/page check. reviewer-code reports only findings with a concrete failure scenario (Bug / Spec miss / Security / Breakage).
- No merge without a recorded human OK. Nothing factory-owned lands in the target repo; hooks never alter non-factory sessions.

## Technical Decisions

- **Paradigm:** event sourcing, LLM as untrusted client. `src/core` pure; `src/store` (paths, jsonl, locks, `loadRun`); adapters `src/cli`, `src/hooks` never import each other; only `paths.ts` resolves paths.
- **AD-1/2** State = total fold of `commands.jsonl` alone; CLI validates before append; facts only verify and are embedded or named by `id`. Agents read their brief's inputs, write only their step dir; only the conductor calls `factory`.
- **AD-3/24** Loop `decide → next → claim → do → done`. `next` (mutating) returns `{steps, in_flight, wait?, done?}`; kinds `spawn|resume|ask_human|run_check|enter_worktree`; `step_id` = `step_issued` ULID; `issued → claimed → reported → verified|reissued`.
- **AD-4/28/29** CLI alone writes `commands.jsonl`; hooks write only per-session fact files, inbox, `plugin-env.json`, `hook-errors.log`. One `O_APPEND` write per line, dedupe by `id`. Run lock only around fold→validate→append; checks run unlocked with `basis_seq`+`sha`.
- **AD-5** Envelope `{v:1,id:ULID,ts,run,session?,kind,actor,corr,data}`; typed union + validator in `core/events.ts`.
- **AD-6/26** Decisions only from `human_prompt`/`prompt_text` facts in `inbox/<session>.jsonl`. Arg-less `factory decide` consumes via `mkdir inbox/consumed/<prompt_id>`. It finds the transcript itself (never from the fact) and matches the exact turn by `promptId`, `sessionId`, `turnOrigin:"human"`, text.
- **AD-7** `core/verify.ts` alone owns attribution and claim→evidence; only `step_verified` unblocks.
- **AD-8/30** All git and checks run in the CLI (baseline, clean worktree at SCAFFOLD, `spec.lint`/`plan.lint` at gates, tests, merge). CLI commits after each builder `done`; builder never commits.
- **AD-9** `repo-hash` = 12 hex of sha256(realpath(git common dir)); `run-id` = `<slug>-<4 base32>`, atomic mkdir; branch `factory/<run-id>`.
- **AD-10/11/27** Artifacts under `~/.factory/<repo-hash>/runs/<run-id>/artifacts/steps/<step_id>/`; approvals pin sha256. `out.md` line 1 is `VERDICT: …` (reviewers) or `STATUS: …`; parse failure → `MISSING_EVIDENCE` + reissue. Schemas in `core/artifacts.ts`.
- **AD-12** Sync Stop hook blocks unless `mayStop(state, background_tasks)`; SessionStart injects a "run `factory next`" nudge.
- **AD-13/14** Exec-form hooks `bin/factory hook <event>`; unbound sessions exit 0 silently; errors exit 0 and log. Facts whitelisted; `core/redact.ts` at every write.
- **AD-15** CLI runs `git worktree add <repo>/.claude/worktrees/factory-<run-id>` and excludes it via `.git/info/exclude`; conductor enters by path.
- **AD-18/32** `factory record` writes redacted recordings (interactive sessions only); `v:1` changes additive only.
- **AD-19/35** Node built-ins only, Node ≥ 22.18; `bin/factory` sh shim. Idempotent `factory setup` creates `~/.factory`, records Node, merges settings; else `SETUP_REQUIRED`.
- **AD-25** `--session ${CLAUDE_SESSION_ID}` on every call; `session_bound` writes `sessions/<session>.json`; non-holders get `NOT_HOLDER`.
- **AD-31** Guard denies writes under `~/.factory/` or `~/.claude/projects/` except claimed step dirs and a plain conductor `factory …`; case-folded, realpath-resolved. A tripwire only.

**Spike verdicts that change the build:**
- `/clear` gives a new `session_id` and never auto-starts a turn. Ruling: SessionStart(clear) rebinds by Claude process identity (parent pid + start time). Story 1.3 must test the start-time guard; `--resume`/crash use normal resume.
- `~/.factory` worktrees prompted on every entry, hence the in-repo placement above; enter once per session.
- Forgery: guard evaded via base64; `decide` trusted a forged `transcript_path` and replayed old turns. Hence AD-6's rules.
- Setup must create `~/.factory` (sandbox can't). Async fact hooks proved complete. `background_tasks` feeds `mayStop` directly. `<task-notification>` wake-ups are not `/factory` prompts.

## Cross-Story Dependencies

- 1.1 underpins all. 1.2's `decide` needs 1.3's prompt facts and inbox, so no gate works until both land. 1.4 needs 1.2+1.3; 1.5 needs 1.4.
- Epic 1 recordings become replay regression fixtures (epic 4).
