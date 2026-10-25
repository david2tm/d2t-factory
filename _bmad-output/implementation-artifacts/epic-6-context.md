# Epic 6 Context: Dry Run 1 Product Changes

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Dry run 1 was the first end-to-end run on an unseen brownfield repo. It stopped in BUILD and surfaced seven product problems that the shipped stories (0-1 to 5-2) can't fix without contract changes. This epic amends that shipped behaviour so dry run 2 can reach WRAP, merge, recording and replay. The changes: the Stop hook stops fighting a human who rejected a tool call; every card says what to type and what happens next; the time limit becomes optional and neutrally worded; a claim waiting on the human or on checks is never shown as UNVERIFIED; the human can read gate-pinned artifacts on the board; and SCAFFOLD fixes environment problems it can repair itself before paging the human. Every change is additive within event schema `v:1`. There is no new process, route, dependency or write path.

## Stories

- Story 6.1: Stop hook yields to a human rejection; factory-owned block cap
- Story 6.2: Cards that say what's next; intake task and scope; optional time limit
- Story 6.3: Claim waiting states and pinned-artifact view
- Story 6.4: SCAFFOLD repair round

## Requirements & Constraints

- **Stop (CAP-14).**
  - The conductor still can't end a turn while its run is working. It may also stop when the human rejected a tool call in that turn.
  - A human interrupt ends the turn without Stop firing. Nothing may depend on Stop firing after an interrupt.
  - A stop let through at the factory's block cap is recorded and shown on the board.
- **Time limit (CAP-2, CAP-11).**
  - The time limit is optional.
  - Without a limit there is no budget clock and no cut gate, and the lane shows elapsed time. The slice time box still bounds each slice.
  - `started` is asked for, and accepted, only alongside a limit.
  - No surface says "exercise" or "interview". Use `time limit 2:00` or `no time limit`.
- **Cards.**
  - Every human ask shows the same content in chat and on the board, in this order: title, reason, details, `To continue, type one of:`, then each `command — then`, then a reply line.
  - The reply line must be true for its card. At intake, a chat reply changes the intake and the card comes back. At every other card, a chat reply changes nothing (decisions are typed only), and changes go through `rework` or `rule … retry`.
  - The intake card shows the agreed task and scope.
- **Claims (CAP-15).**
  - UNVERIFIED means only "claimed, and the hook facts never arrived".
  - A claim waiting on a human decision or on CLI checks shows as CLAIMED with what it waits on, and never goes overdue.
- **Artifacts (CAP-15).** The human can read, read-only, each artifact a gate pins (intake, spec, design, plan), and copy its path.
- **SCAFFOLD (CAP-4).** Before the SCAFFOLD-failure ask there is at most one factory repair round, and that round changes only the run contract's commands. A project-side cause (secrets, services, a broken repo) skips the round.
- **Success (dry run 2).**
  - No human prompt outside the closed list.
  - Every card printed in chat has its `then` lines and reply line.
  - No red UNVERIFIED appears on a waiting claim.
  - A rejected tool call ends the turn at once, and the lane shows PAUSED.
  - A run with no time limit shows elapsed time and never raises a cut.
  - The full suite passes, and recording fixtures fold byte-identical unless a change is deliberate and noted.

## Technical Decisions

- **AD-12 Stop exits (6-1).**
  - **Rejection exit.** Allow the stop when the session's own transcript holds a tool use the human rejected, after the turn's last human prompt. Then append `stop_yielded{reason: human_rejected, tool_use_id}`.
    - Locate the transcript the AD-6 way: `~/.claude/projects/*/<session_id>.jsonl`, exactly one realpath match under `~/.claude/projects/`, never taken from a fact. Move the AD-6 locator from `cli/` into `store/` so hooks can share it.
    - Match on Claude Code's structured rejection record, never on a substring. Deny-rule and guard denials are not human and must not match.
    - The record is undocumented. The story starts with a spike: reject a tool call in a real session (a manual step for d2t) and pin the record as a test fixture.
  - **Block cap.** Count consecutive blocks for the holder session in `~/.factory/sessions/<session>.stop`.
    - Reset the count on a `tool_*` fact from that session newer than the last block, or on a human prompt.
    - At `STOP_BLOCK_MAX` (3), let the stop through and append `stop_forced{blocks}`.
    - Block whatever `stop_hook_active` says. Claude Code's own cap (8 continuations) must never be reached.
  - **Fallback.** If the spike finds no reliable record, ship the block cap alone.
  - Unbound and non-holder sessions still pass.
  - `PreToolUse` may log `tool_requested{tool_use_id}` as corroboration, but that alone is not enough.
- **AD-31 guard.** It denies writes under `~/.claude/projects/`. That is why the conductor can't forge a rejection into its own transcript.
- **AD-34 card (6-2).**
  - Shape: `card = {type, title, reason_label?, reason?, details?[], options?[{command, then}], reply?, commands[]}`.
  - `commands = options.map(command)` when options is present. Old readers and recordings keep working.
  - All cards are single-sourced in `cards.ts`. The conductor prints the card verbatim, in the order above, at the end of any turn that ends on `ask_human`.
- **AD-27 intake schema (6-2).** `task` (one line, required), `scope{in[], out[]}`, `limit_min?`, `slice_timebox_min?`, `ui_free`, `reviewer_overrides`, `started?` (only with `limit_min`).
  - Task and scope live in front matter, so the card never parses prose.
  - The `sha256` pinned by `intake_confirmed` (AD-10) covers them.
- **AD-17 clock (6-2).**
  - The clock runs from `run_started.ts`, or from the intake's `started` if earlier. It never pauses.
  - With `limit_min`, it is the budget clock (`cut_at`, `ends_at`).
  - Without a limit, `budgetOf` returns null, the projection carries only `clock_start`, and no cut is ever raised.
- **AD-7 overlay (6-3).**
  - `claimOverlay` returns `waiting_on: 'human' | 'checks' | null`.
    - `human`: an `ask_human` step, or the subject of an open ask.
    - `checks`: the step's `run_check` steps are issued and not yet verified.
  - Only a null wait has an `overdue_at`.
  - The CLI's overdue reissue (AD-24) and the board both read this one overlay. Remove the duplicate rule in `next.ts`.
  - "Awaiting" is a gloss on CLAIMED, not a fourth state. No new color or token.
- **AD-23 pinned artifacts (6-3).**
  - At `step_verified` of an intake, spec-writer, designer or slicer step, the CLI embeds in event data:
    - the redacted body, through the one `redact.ts` (AD-14);
    - the `sha256` of the file as written;
    - its path.
  - The body is capped at `ARTIFACT_EMBED_MAX` (64 KiB), with a truncation marker.
  - The dashboard never reads `artifacts/`, and it stays GET-only with no new route.
  - A rework marks the older version superseded (AD-33 voids).
  - Replay gets the artifacts from recordings.
- **AD-8 / AD-24 SCAFFOLD repair (6-4).**
  - On a failed install, health or test check, if `SCAFFOLD_REPAIR_ROUNDS` (1) remains, `next` resumes the same scaffolder with a repair brief. The brief holds the failed checks, their redacted log tails and the envelope rules. No card is raised.
  - The scaffolder then either reports `DONE` with a revised contract (the CLI re-runs the checks, and a second failure raises the card) or reports `ESCALATE` / `Scaffold failed: <why>` (the card is raised at once).
  - The card's reason lists both rounds.
  - **Repair envelope.**
    - The scaffolder may change only the contract's commands: env vars, flags, the package-manager command form, and timeouts.
    - It may point tool caches at `runs/<run-id>/cache/`, which every contract command receives as `FACTORY_CACHE_DIR` (resolved in `paths.ts`).
    - It never deletes or edits anything outside the worktree.
    - `git.worktree_clean` still fails any tracked-file or lockfile change, so the repair can't add a dependency.
- **AD-21 constants.** `STOP_BLOCK_MAX` 3, `SCAFFOLD_REPAIR_ROUNDS` 1, `ARTIFACT_EMBED_MAX` 64 KiB, all in `config.ts`.
- **AD-32.** Changes are additive only within `v:1`. Old recordings have no `options`, so the board falls back to `commands`.

## UX & Interaction Patterns

- **PAUSED lane notice.** `PAUSED · you rejected a tool call 15:24` (`stop_yielded`) or `PAUSED · the conductor stopped after 3 blocks 15:24` (`stop_forced`).
  - Shown in text-2 beside the stage. It clears on the run's next command.
  - Dashboard-only, never a chat prompt (CAP-10).
- **Elapsed clock.** `ELAPSED 0:47 · no limit` in the same 236 px Budget clock slot: clock glyph, readout and text-3 suffix. It counts up and stops when the run ends. No meter, cut marker or caption.
- **Action slot.** Each command row has its Copy button, with its `then` line below in body-sm, needs-text-3. The reply line closes the slot in body-sm, text-3. Several commands stack in one slot.
- **Intake confirm card.**
  - Lines, in order: the title `Intake — confirm the task`, then the settings line `time limit 2:00 | no time limit · slice time box · UI-free · reviewers`, then `Task:`, `In scope:` and `Out of scope:`, then the approve option with its `then` line and the reply line.
- **Claim chip glosses.** `CLAIMED · awaiting Master d2t` and `CLAIMED · checks running` use the CLAIMED treatment, with the gloss in holo-text-2.
  - Drawer proof rows: `waiting on Master d2t — <card title>` and `waiting on <check names>`.
  - The truth legend keeps three entries.
- **Artifact drawer (third Evidence drawer variant).**
  - **Opens from** a Gate card's file row (rendered as a button), the intake seal, or a Decision drawer evidence row.
  - **Title:** `Artifact · <name> · <run-id>`.
  - **Meta table** (92 px key column):
    - the path in mono, with the 30×30 Copy-path button, which copies the absolute path;
    - the sha256, first 12 characters shown, full value in the accessible name;
    - `pinned by <seal line>` in gold, or `not yet approved` in text-3.
  - **Body:** the raw bytes in monospace, read-only and scrolling, with no Markdown rendering. A `truncated at 64 KB` note appears when the body was cut.
  - **Note:** gold left rule reading **Master d2t approves these bytes.**
  - Copy feedback: `Copied` or `Copy failed — path selected`.
  - Read-only primitives now include copying an artifact path and opening an artifact view.

## Cross-Story Dependencies

- **6-1 goes first.** It blocks dry run 2. 6-2, 6-3 and 6-4 are independent and can run in any order.
- **6-3 bundles two findings.** Claim waiting states and the artifact view both change the Claim and Evidence drawer and the projection's card shape.
- **Shared file `cards.ts`.**
  - 6-4's two-round SCAFFOLD-failure reason goes in it.
  - 6-2 adds `options` and `reply` to that same card: `retry <note…>`, `accept`, `abandon`.
  - Whichever story lands second must merge with the first.
- **Contract docs are already amended.** SPEC, review-policy, truth-layer, pipeline-stages, ARCHITECTURE-SPINE, EXPERIENCE and DESIGN already carry these changes. The stories implement them.
- **Agent prompts change.** 6-2 changes `skills/factory/SKILL.md` to print cards in AD-34 order. 6-4 changes step 6 of `agents/scaffolder.md` to escalate only on project-side causes, and to fix only what a repair brief allows.
