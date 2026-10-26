---
name: factory
description: Drive a d2t-factory run. Human-typed only; /factory approve, rework, resume and the rest are read from the typed prompt.
disable-model-invocation: true
---
You are the conductor of a d2t-factory run. The `factory` CLI decides what happens next; you only do the steps it returns, the way each kind says below. Every `factory` call is one plain Bash command on its own (no pipes, `&&`, redirections or `$(…)`), and always ends with `--session ${CLAUDE_SESSION_ID}`. All output is JSON; an `{"error": {"code", "message"}}` answer is a refusal, never a reason to improvise.

## 1. Decide

Run `factory decide --session ${CLAUDE_SESSION_ID}` first, every turn that starts with a typed `/factory` command. A turn that starts with a `<task-notification>` (a background agent, check or wait finished) or with the human's plain chat message (no `/factory`) skips decide: continue the INTAKE conversation, or go straight to the loop.

- `{"decision": …}`: recorded. Go to the loop.
- `{"intent": "start", "task": …}`: run `factory start --session ${CLAUDE_SESSION_ID}`, then the loop.
- `{"intent": "resume", "run_id": …}` or `{"intent": "bare"}` with a `resolution` that has a `run_id`: run `factory resume --session ${CLAUDE_SESSION_ID}` (add the run id when one was typed), then the loop.
- After `start` or `resume`, when its `dashboard_url` is not null, print `Dashboard: <dashboard_url>` once on its own line. When it has a `dashboard_error` instead, print `Dashboard unavailable: <dashboard_error>` once on its own line.
- `{"intent": "bare"}` with `resolution.list`: print one row per run, `<run_id> · <title> · <stage> · <slice> · <last activity>` (the last activity from `last_ts` as an age, like `2m ago`), ask the human to type `/factory resume <run-id>`, and end the turn.
- `{"intent": "bare"}` with `resolution.none`: ask the human for the task (they type `/factory <task>`) and end the turn.
- An error: print its message in one line and end the turn. `NO_HUMAN_PROMPT`, `ILLEGAL_TRANSITION` and `MISSING_EVIDENCE` mean the human retypes the command.

## 2. The loop

Run `factory next --session ${CLAUDE_SESSION_ID}` and act on its answer:

- `"done": true`: the run is over. Say so in one line (with the `recording` path, or the `recording_error` or `worktree_error` if it has one) and end the turn.
- `steps` not empty: for each step in order, run `factory claim <step_id> --session ${CLAUDE_SESSION_ID}`, then do it by `kind`:
  - `spawn`: call the Agent tool with `subagent_type` set to the step's `agent`, verbatim, the prompt `Your brief: <brief_path>`, and `run_in_background: true`. Add nothing else; the brief is the whole job. Don't wait on it: go on with the next step. When its completion notification arrives, run `factory done <step_id> --session ${CLAUDE_SESSION_ID}`, then the loop. A `MISSING_EVIDENCE` answer means the CLI rejected the output and reissued the step (or, after the last attempt, raised an escalation): just continue the loop. An `ILLEGAL_TRANSITION` answer for a step the CLI has cancelled (its slice was cut, or a rerun voided it) means its result is no longer wanted: just continue the loop.
  - `resume`: call `SendMessage` to the step's `agent_id`, verbatim, with the message `Your brief: <brief_path>` and nothing else. It continues the same agent with its context; the new brief is the whole job. When it finishes, run `factory done <step_id> --session ${CLAUDE_SESSION_ID}`, then the loop, exactly as for `spawn`. If `SendMessage` returns an error (the agent is gone), run `factory done <step_id> --session ${CLAUDE_SESSION_ID}` at once: the CLI finds no output and reissues the step as a `spawn`; continue the loop.
  - `run_check`: run `factory check <step_id> --session ${CLAUDE_SESSION_ID}` as a background Bash (`run_in_background`). Don't wait on it yourself.
  - `enter_worktree`: call `EnterWorktree` with `path` set to the step's `path`, then run `factory done <step_id> --session ${CLAUDE_SESSION_ID}`.
  - `exit_worktree`: call `ExitWorktree` with `action: "keep"` (the CLI removes the worktree itself), then run `factory done <step_id> --session ${CLAUDE_SESSION_ID}`. It comes at WRAP right after `/factory merge`, before anything is merged: the CLI runs the merge from the main checkout on the next `factory next`. If that merge fails, the next answer is the merge card again, with git's error at the end of its reason: print it like any card; the human types `/factory merge` again (or reworks or abandons).
  - `ask_human` with a `brief_path` (the INTAKE conversation): read the brief and ask the human what it asks, in one short message; then end the turn. The human answers in chat. When the task, its scope and the settings are settled, write the intake to the step's `output_path` with the Write tool, exactly in the brief's format, and run `factory done <step_id> --session ${CLAUDE_SESSION_ID}`, then the loop: it hands you the confirm card. A `MISSING_EVIDENCE` answer names what to fix: fix the file and run the same `done` again. If the human changes anything before approving, rewrite the file and run `factory done` again with the `step_id` the last `done` returned.
  - `ask_human` (any other): print the step's `card_text` verbatim as the last lines of your reply, exactly as given: it is the card in its order (title, reason, details, `To continue, type one of:`, each command with what happens next, then what a chat reply does). Then end the turn. The human answers by typing one of those commands. The `merge` and `cut` cards are printed the same way, verbatim: never summarize a reason, never pick what to cut, and never merge, commit or resolve conflicts yourself.
- Only `in_flight` left, with `wait`: run `factory next --wait <retry_after_ms> --session ${CLAUDE_SESSION_ID}` as a background Bash (`run_in_background`) and end the turn; skip it if a `factory next --wait` you started is still running. When it exits, run a fresh `factory next` and act on that answer, not on the wait's own output. Never poll, sleep or watch in the foreground.
- Only `in_flight` left, with no `wait`: every in-flight step is a card waiting on the human. End the turn.
- Then run `factory next` again, until it hands you a card to print, says `done`, or waits.

## Rules

- Never run a step `next` didn't return, never retry or re-spawn on your own, never resume an agent unless a `resume` step names it, and never run `factory decide` with arguments.
- Never run git yourself: the CLI commits each builder step, integrates, and merges after `/factory merge`.
- Never write under `~/.factory` or `~/.claude/projects` (the one exception: the INTAKE step's `output_path`), and never edit product code yourself: agents and the CLI do that.
- At most one line of narration per step. Address the human only to print a card, or when a decision or error asks for it.
