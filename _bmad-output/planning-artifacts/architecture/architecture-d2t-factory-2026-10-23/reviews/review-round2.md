---
review: round-2 confirmation
target: ../ARCHITECTURE-SPINE.md (revised 2026-10-23)
inputs: review-adversary.md, review-rubric.md, review-reconcile-spec.md, review-reconcile-ux.md, review-verification.md
date: 2026-10-23
scope: every round-1 CRITICAL/HIGH (verification = the 5 "Contradicted" items, plus the gap items the revision relied on); new contradictions introduced by the revision; compliant-but-incompatible pairs
counts:
  round1_critical_high: 62
  closed: 49
  partial: 13
  open: 0
  new: {critical: 1, high: 9, medium: 10, low: 4}
---

# Round-2 confirmation review: d2t-factory spine

## Verdict

The revision closes almost every round-1 join problem: `corr`, commands-only fold, step lifecycle, artifact schemas, decision grammar, inbox ledger, JSONL and lock discipline, worktree takeover, env and exit-code realities. No round-1 critical/high item is fully open.

What remains is a second layer. The new rules interact badly in places, and some of them were written against the vocabulary of the old spine:

- "claim" now means two different things.
- `wait` is a response in AD-3 but an open step in AD-12.
- The decision consumption queue can wedge.
- The commit owner contradicts "all git in the CLI".
- `basis_seq` rejects checks whenever anything else happens.
- The session→run index that every synchronous hook needs was dropped.
- Two step kinds (`enter_worktree`, and parse-failure retry) have no legal path through "only `step_verified` unblocks" and "never run a step `next` didn't return".

Fix the one critical and the nine highs before epics. They are mostly one-sentence edits.

---

## 1. Round-1 CRITICAL/HIGH disposition

### review-adversary.md (17)

| ID | Status | Note |
| --- | --- | --- |
| C1 corr undefined | Closed | AD-5 `corr` (facts null, commands step_id); AD-7 attribution by realpath plus `agent_id`. Residual medium N-M9 (resume rounds share `agent_id`). |
| C2 claims vs facts in fold | Closed | AD-1 commands-only; `step_verified` is the only unblocker; facts are pinned by id. |
| C3 step lifecycle | Closed | AD-24 `step_issued`/`step_claimed`/`step_reissued`, `in_flight`, `CLAIM_TAKEN`. The revision introduced N1 and N2 here (new). |
| C4 artifact schemas | Closed | AD-27. Intake authorship is tracked under spec-H1. |
| C5 decision matching | **Partial** | Grammar and no-arg `decide` close the re-typing hole. But "illegal decision stays unconsumed" combined with "consume oldest" wedges the queue, and `start`/`resume` prompt consumption is unstated. See N3. |
| H1 session id / binding | **Partial** | AD-25 closes the writer and supersede questions. "Current holder is live" (AD-25, also AD-15) has no definition, and AD-21 says the CLI never reads liveness. |
| H2 inbox | Closed | AD-26. |
| H3 data / stage / IDs | Closed | AD-5 typed union, stage enum, `check_ran.data`. |
| H4 Stop traps conversation | **Partial** | INTAKE, designer and escalation are now `ask_human`. But a mixed open set (an escalation on S2 plus background reviewers on S1) still blocks. See N2. |
| H5 partial-line reads | Closed | AD-28. |
| H6 lock protocol | **Partial** | Scope, stale-lock breaking and the wait limit are closed. The `basis_seq` rule as written rejects every check under parallel work. See N7. |
| H7 sha-pinned evidence | **Partial** | The rule exists, but nobody may legally make the commit: AD-8 says "every git operation lives in the CLI", while AD-30 and `done --sha` imply the builder commits. See N6. |
| H8 output_written rules | Closed | AD-31. The guard side regressed (N10). |
| H9 findings format | Closed | AD-11. |
| H10 build order / evolution | **Partial** | AD-32 puts the hooks in increment 1. But the map puts the build loop (CAP-8) in increment 1, while the slicer/Gate 2 (CAP-7) and intake (CAP-2) are in increment 3. The state machine needs `intake_confirmed` and `gate_2_passed` before BUILD, and increment-1 recordings are byte-identical fixtures. |
| H11 artifact layout | Closed | AD-10. |
| H12 model-invoked forge | Closed | AD-6 `disable-model-invocation`; no tool hook emits prompt facts. Confirmed by V-13. |

### review-rubric.md (11)

| ID | Status | Note |
| --- | --- | --- |
| C1 WorktreeCreate global takeover | Closed | AD-13 registers no Worktree hooks; AD-15 has the CLI create the worktree. |
| H1 corr | Closed | |
| H2 schemas / roster | Closed | AD-27. |
| H3 slice/run state machine | **Partial** | The slice machine, ABANDONED, partial cut and rerun are added. The slice diagram still lacks edges that ADs require: `FINDINGS_QUEUED → ESCALATED` (non-convergence, AD-21); `CLOSED → BUILDING` (`rework S<n>` voids `slice_closed`, AD-33); `ESCALATED → CUT`/`CLOSED`; and a WRAP merge-conflict loop (AD-8). |
| H4 intake/abandon/grammar | Closed | Conventions grammar. |
| H5 forgeable evidence | Closed | AD-31 guard, Open Question. Guard attribution regressed (N10). |
| H6 recording format | Closed | AD-18, AD-14 transcript paths, `record` in increment 1. |
| H7 dev-server lifecycle | Closed | AD-20, envelope. |
| H8 greenfield identity | Closed | AD-9 `git init` first. |
| H9 crash recovery | Closed | AD-29, AD-20 terminal release, `abandon`. |
| H10 Node pinning | Closed | AD-19 shim, Stack 26.12.1. Bootstrap order is a new medium (N-M6). |

### review-reconcile-spec.md (15)

| ID | Status | Note |
| --- | --- | --- |
| C1 INTAKE blocked by Stop | Closed | AD-12 open-step predicate. |
| C2 greenfield before git init | Closed | AD-9. |
| H1 intake provenance | **Partial** | `approve intake` is human. But `limit_min`, `ui_free` and `reviewer_overrides` are LLM-authored front matter. The human is not required to see them, and they are not sha-pinned. AD-27 says "agents write" while AD-3 says INTAKE content arrives by `--note`, so the authorship channel is ambiguous. |
| H2 budget clock origin | Closed | AD-17. |
| H3 cut re-raise loop | **Partial** | `keep` suppresses re-raise. A partial `cut S5` leaves S6 unbuilt past the threshold, so `next` re-raises the cut. |
| H4 pipelined findings | Closed | AD-30. |
| H5 designer trigger | Closed | AD-27. |
| H6 roster | Closed | AD-27. |
| H7 parsed artifact schemas | Closed | AD-27, `SPEC_MAX_LINES`. |
| H8 corr / spike fallback | Closed | |
| H9 resume resolution | **Partial** | Same gap as adversary-H1: "live" holder is undefined. |
| H10 crash / abandon | Closed | |
| H11 brownfield baseline | Closed | AD-8. |
| H12 dev-server owner | Closed | AD-20. |
| H13 setup / permissions | Closed | AD-35. |

### review-reconcile-ux.md (14)

| ID | Status | Note |
| --- | --- | --- |
| C1 Needs You commands | Closed | AD-34 `commands[]`, plus an override. |
| C2 intake command | Closed | |
| C3 board data in events | Closed | AD-23. |
| H1 escalation label/line | **Partial** | The labels are closed, but their position is not. AD-11 says line 1 has "only two forms" and that "ESCALATE is followed by" a label, so it is unclear whether the label goes on line 1 or line 2. An agent prompt and the parser can disagree, which loops through MISSING_EVIDENCE. |
| H2 slice lifecycle / columns | Closed | AD-30. |
| H3 corr / resume attach | Closed | |
| H4 SIGNAL LOST | Closed | AD-21. |
| H5 deadlines in projection | Closed | AD-16, AD-18. |
| H6 multi-run recording | Closed | AD-18. |
| H7 "verified by hook" | Closed | AD-7, overrides. |
| H8 cut transitions | **Partial** | Same gap as spec-H3: a partial cut re-raises. |
| H9 rework target | Closed | Grammar `gate1\|gate2\|S<n>`. The CLI picks which Gate-1 steps re-run. That has a single owner, so it is medium at most. |
| H10 bare `/factory` resolution | **Partial** | "Live" holder is undefined. |
| H11 whitelist / session | Closed | AD-14, AD-5. |

### review-verification.md (5 contradicted, plus the gap items used)

| ID | Status | Note |
| --- | --- | --- |
| V-01 WorktreeCreate | Closed | |
| V-02 namespaced `command_name` | Closed | Anchored matcher; `prompt_text` from UserPromptSubmit. |
| V-03 no plugin env in Bash | Closed | `plugin-env.json` via SessionStart. Bootstrap order is N-M6. |
| V-04 no exit code | Closed | AD-14. |
| V-05 auto-install | Closed | AD-19. |
| V-06 Stop `background_tasks` (gap) | Partial | Used, but only for `wait` steps. See N2. |
| V-08 resume re-fires SubagentStart (gap) | Closed | Residual N-M9. |
| V-14 EnterWorktree path rules (gap) | **Not honored** | See N9. |

**Totals: 49 closed, 13 partial, 0 open.**

---

## 2. New problems introduced by the revision

### CRITICAL

**N1. "Claim" is overloaded, and AD-24 times out in-progress steps.**

The word means three things:

- **AD-5:** "A **claim** is `step_reported`".
- **AD-7:** claim states are `claimed` (pending report).
- **AD-24:** "Claiming" is `factory claim` → `step_claimed`, and the step state is `claimed`.

The next AD-24 bullet then says "A claim still unverified after `CLAIM_OVERDUE_MS` is reissued once". Read in AD-24's own vocabulary, any builder, check or `ask_human` step that has been `claimed` for 30 s gets reissued, with a new `output_path` and a second agent spawned into the same worktree. AD-30's "no builder step is claimed" uses the AD-24 sense too.

- **Fix (AD-24):** "**Overdue reports.** A step in `reported` whose AD-7 evidence is still missing `CLAIM_OVERDUE_MS` after its `step_reported` is reissued once, then raises an `ask_human`. A `claimed` step is never timed out; it is reissued only as an orphan."
- **Fix (AD-5/AD-7):** rename the overlay states to `reported | verified | unverified`, keeping the UX chip label CLAIMED as display only.

### HIGH

**N2. The Stop predicate doesn't match the step model.**

- AD-3 makes `wait` a `next` response ("On `wait`, the conductor runs `next --wait`").
- AD-24 makes in-flight work `claimed` agent or check steps.
- AD-12 allows a stop only if "every open step is `wait`". In-flight reviewers are open `spawn` steps, not `wait`.

Two cases block:

- **Background reviewers alone:** the Stop hook blocks, which forces polling.
- **An escalation on S2 plus background reviewers on S1:** the open set is mixed, so the hook blocks. The human can't get a turn to type `/factory rule E1`.

It is also unstated whether `wait` and `done` are `step_issued` and claimable, even though the AD-3 loop says "for each step `factory claim`".

- **Fix (AD-12):** "returns true iff every open step is either `ask_human`, or `claimed` and running in the background (its subagent in `background_tasks`, or its `run_check` a background shell), or the run is terminal."
- **Fix (AD-3):** "`wait` and `done` are responses, never `step_issued` and never claimed; `wait` is returned iff no step is due and `in_flight` is non-empty."

**N3. The decision queue can wedge, and prompts consumed by `start`/`resume` are undefined.**

- AD-6 has `decide` consume the *oldest* unconsumed prompt, but an illegal decision "stays unconsumed". One mistyped `/factory approve gate2` at Gate 1 therefore blocks every later `decide` in that session.
- Nothing says whether `factory start <task>` or `resume` consumes the invoking `/factory` prompt. If they don't, the next `decide` consumes the stale task prompt as a non-decision instead of the human's approval.
- **Fix (AD-6):** "Every `/factory` turn begins with `factory decide`, the only consumer. It consumes the newest unconsumed prompt of the session and marks older ones `superseded`. An illegal decision is consumed, returns `ILLEGAL_TRANSITION`, and the human retypes. `start` and `resume` act only on the prompt `decide` just returned."

**N4. The parse-failure retry violates AD-3.**

- AD-11 says that on MISSING_EVIDENCE "the conductor resumes the same agent to fix the file".
- AD-3 says the conductor "never runs a step that `next` didn't return".
- A conductor that obeys AD-3 sees the step still claimed by its own session. It is not an orphan, so it never gets reissued: `next` returns `wait` forever.
- **Fix (AD-11):** "…fails `done` with `MISSING_EVIDENCE`; the CLI appends `step_reissued` as a `resume` of the same `agent_id`, attempt+1, with the parser error in `brief.md`. The conductor never resumes on its own."

**N5. `resume` steps have no target, and nothing covers a resume after `/clear`.**

- The AD-3 step shape has `agent` (the type) but no `agent_id`, yet SendMessage needs the ID.
- After `/clear` the conductor no longer remembers it.
- AD-24's "resume whose agent is unreachable degrades to spawn" has no CLI surface for reporting "unreachable". This runs deterministically on every post-`/clear` builder round (a CAP-1 success criterion).
- **Fix (AD-3):** add `agent_id?` to the step shape, required for `resume`, taken from the AD-7 attribution of the agent's previous step.
- **Fix (AD-24):** "`next` issues `resume` only if that `agent_id` was spawned under the current `session_bound`; otherwise it issues `spawn` with a rework brief."

**N6. Nobody may legally make the builder commit.**

- AD-8: "Every git operation lives in the CLI", and its Prevents bullet forbids the conductor from running git.
- AD-30: "Every builder step ends in a commit, `step_reported.data.sha` required". The CLI verb is `done … [--sha]`.
- A builder prompt that follows AD-8 doesn't commit. A CLI that follows AD-30 then rejects every builder `done`, and no slice ever closes.
- **Fix (pick one), option A, CLI commits:**
  - **AD-30:** "At `done` of a builder step the CLI commits the worktree (`S<n> a<attempt>`) and records the sha; builders never run git."
  - **CLI verbs:** remove `--sha`.
- **Fix (pick one), option B, builder commits:**
  - **AD-8:** "…lives in the CLI, except the builder's own `git commit` in the worktree."
  - **AD-30:** "The conductor passes HEAD via `done --sha`, and the CLI verifies it is on `factory/<run-id>`."

**N7. `basis_seq` rejects every check while other work is running.**

- AD-29 rejects a check's append "if a state-changing command came in between".
- Every command changes the fold, so every parallel reviewer `step_reported`/`step_verified`, and every `next` `step_issued`, invalidates a long-running test. The slice-close check then never lands while reviews are pipelined.
- **Fix (AD-29):** "…rejected only if, after `basis_seq`, a builder `step_claimed`/`step_reported` or a void (AD-33) was appended, or the branch HEAD differs from the check's `sha`."

**N8. Hooks have no way to resolve session → run.**

- The original rule ("CLI writes `sessions/<session>.json`") was dropped. AD-25 says only "No hook writes `~/.factory/sessions/`", yet the seed still lists `sessions/<session>.json`, with no writer or reader.
- Every synchronous hook needs the lookup on every prompt or tool call: Stop, the PreToolUse guard, UserPromptSubmit. Without an index they scan every `commands.jsonl` under `~/.factory`.
- A stale index after `/factory resume` keeps the superseded terminal's Stop hook blocking forever, because the 8-cap resets on each tool call.
- **Fix (AD-25):** "On `session_bound` the CLI atomically writes `sessions/<session>.json {repo_hash, run_id}` and deletes the superseded session's file. Hooks resolve the run only through that file; if it is absent, the session is unbound."

**N9. `enter_worktree` can't complete.**

- AD-7 has no verifier row for it, and AD-7 says "Only `step_verified` unblocks dependent steps".
- AD-15 re-issues it unconditionally "on every new session binding". V-14 says that from within a worktree session, EnterWorktree accepts only paths under `.claude/worktrees/`. So after `/clear`, or a resume started inside `~/.factory/<hash>/worktrees/<run-id>`, the call fails.
- **Fix (AD-15):** "`next` issues `enter_worktree` only when `realpath(process.cwd())` of the calling CLI is outside the run's worktree."
- **Fix (AD-7 row):** "`enter_worktree` | the next CLI call's `process.cwd()` is inside the worktree (CLI-observed)."

**N10. The write guard needs attribution that doesn't exist yet.**

- AD-31 allows "the step's own `output_path`". The only `agent_id → step` link is the `output_written` fact (AD-7), which only exists *after* the first write. `claim --agent-id` happens before the spawn, so the ID is unknown at that point.
- A strict guard therefore denies every agent's first output write.
- The guard also denies the reviewers' Bash `agent-browser` screenshots under `artifacts/`, which AD-11 `observed` expects.
- **Fix (AD-31):** "The guard allows `Write`/`Edit` to the `output_path`, and `Bash` writes into `artifacts/steps/<step_id>/`, of any step currently `claimed` in the bound run. Attribution stays AD-7's job."
- **Fix (AD-11):** screenshots go to `artifacts/steps/<step_id>/`.

### MEDIUM (contradictions only)

- **N-M1.** AD-8 says "Checks run only as `run_check` steps". This contradicts inline checks other ADs require: `run_started` `git.baseline` (AD-8), the `next` devserver health check (AD-20, where `devserver` is in the check enum), `git.merged` after a merge, and `git.deps`. **Fix:** "Test, health and lint checks run only as `run_check` steps. `git.*` and `devserver` probes run inline in the CLI verb that needs them, unlocked, and append with `basis_seq`."
- **N-M2.** AD-2 says agents "never touch `~/.factory/` except … `output_path`", but they must read `brief_path` and the input paths it lists (AD-10). **Fix:** "never write under `~/.factory/` except their step's artifacts directory; read only `brief_path` and the inputs it lists."
- **N-M3.** AD-4 says "Hooks write only to `facts/` and the inbox", but SessionStart writes `plugin-env.json` (AD-19) and every hook writes `hook-errors.log` (AD-13). **Fix:** list both.
- **N-M4.** `LOCKED` means both "lock wait exceeded, retry" (AD-29) and "you are not the holder" (AD-25), so a conductor that retries on `LOCKED` loops forever after a takeover. **Fix:** add `NOT_HOLDER` to the CLI codes for AD-25. Also exempt `start`, `resume`, and a `decide` that parses to `resume` from the holder check.
- **N-M5.** The Conventions grammar lists `resume [run-id]` as a decision, but AD-6 says a resume prompt is "consumed as a non-decision". **Fix:** move `resume` and bare `/factory` out of the decision grammar into a "non-decision subcommands" note.
- **N-M6.** Bootstrap order is circular:
  - The shim execs the Node that `factory setup` records, but setup itself runs through the shim.
  - SessionStart, which is also the shim, writes `plugin-env.json` before setup has run. In the first session after setup it is therefore absent.
  - **Fix (AD-19):** the shim falls back to `node` on PATH when it is ≥ the floor and `~/.factory/node` is absent.
  - **Fix (AD-35):** `start` refuses with `SETUP_REQUIRED` while `plugin-env.json` is missing, with the message "restart the session".
- **N-M7.** A RECON cache hit emits `stage_completed{reused}` with no verified recon step. The "current context" reducer query (AD-10) then returns nothing, so the designer trigger and `ui_surface` (AD-27) are undefined. **Fix (AD-10):** "on a hit, `stage_completed.data` embeds the parsed `context` projection and the cached file's sha256; reducer queries treat it as the verified RECON output."
- **N-M8.** The AD-26 consumption order is unspecified. If `mkdir consumed/` happens before the append and the append is then rejected (or the CLI crashes), the prompt is lost. That contradicts "stays unconsumed". **Fix:** "validate under the run lock, then `mkdir`, then append; on append failure, `rmdir`."
- **N-M9.** Resume rounds share an `agent_id`, so AD-7's `(agent_id, step_id)` key can't place a second `subagent_stopped`. **Fix:** "a `subagent_*` fact attributes to the latest step `claimed` for that `agent_id` at or before the fact's `ts`."
- **N-M10.** A takeover while the old holder is live reissues its orphaned claims (AD-24). The old session's builder subagent keeps editing the worktree while a new builder is spawned. **Fix (AD-24):** "an orphaned *agent* step is reissued only after its attributed `subagent_stopped`, or `SIGNAL_LOST_MISSED × HEARTBEAT_INTERVAL_MS` with no fact from that `agent_id`."

### LOW

- The capability map omits AD-35 from CAP-10 and CAP-12, and AD-27 from CAP-9.
- `HEARTBEAT_INTERVAL_MS` is named, but no heartbeat event exists. It is really "any event".
- The memlog's Stop fallback (SessionStart `clear|resume` injects "run `factory next`") and the V-12 `-p` teardown fact loss are missing from Open Questions.
- AD-11 says "each step writes one file", but reviewers also write screenshots.

---

## 3. Compliant-but-incompatible pairs (critical/high)

**P1 (N1): the CLI's `next` and the conductor double-spawn the builder.**

- The CLI implements AD-24's "unverified claims" over `step_claimed`, which is that AD's own vocabulary.
- The conductor claims S1's builder step and spawns it in the background, as AD-3 says.
- At T+30 s, `next` appends `step_reissued` with a new `step_id` and `output_path`. "At most one open step per role" is satisfied, because the old step is reissued, so a fresh builder `spawn` is due.
- The conductor runs it, as AD-3 requires. Two builders now edit one worktree.
- The first builder's `output_written` attributes to the reissued (dead) step, and its work is never verified.
- Each unit is compliant.

**P2 (N2): the Stop hook and the CLI disagree about `wait`.**

- The CLI treats `wait` as a response only (AD-3), so in-flight reviewers stay `claimed` `spawn` steps.
- The Stop hook implements AD-12 literally.
- At S1 pipelined review with an escalation on S2, the open set is {claimed reviewer-code S1, ask_human E1}. `mayStop` returns false and the turn is blocked.
- The conductor cycles `next --wait`. The cap never trips, because each call is a tool call.
- The human can't get a turn to type `/factory rule E1` until the reviewers finish.
- If the CLI author instead issues `wait` as a step, the conductor claims and `done`s it, as the AD-3 loop says. Verification then has no AD-7 row for it, so it never verifies.

**P3 (N6): the builder prompt and the CLI `done` disagree about who commits.**

- The builder prompt follows AD-8 ("every git operation lives in the CLI") and never commits.
- The conductor may not run git (AD-8 Prevents).
- The CLI enforces AD-30 ("`step_reported.data.sha` is required").
- Every builder `done` fails, no `check_ran` can find "a sha that contains its last builder commit", and no slice closes.

N3 also yields a trivial pair: a skill that never calls `decide` on `start`, plus a CLI that consumes the oldest prompt, means the Gate-1 approval is consumed as task text.
