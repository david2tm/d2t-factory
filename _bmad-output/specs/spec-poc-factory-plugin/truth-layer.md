# Truth Layer & Dashboard

Data-flow diagram: `architecture-diagrams.md`.

## Principle

Facts come from instrumentation; meaning comes from a state machine; the LLM conductor's self-report is never trusted alone. The dashboard shows each item as **claimed** (conductor said so) vs **verified** (hook fact or evidence check confirms it). A claim waiting on a human decision or on the CLI's checks is shown as claimed, with what it waits on; only a claim whose hook facts never arrived is unverified.

## Facts — async plugin hooks

- Subagent start/stop with `agent_type`, tool success/failure, test runs.
- Plugin hooks fire inside subagents with `agent_id`/`agent_type` (confirmed by research).

## Semantics — factory CLI state machine

- Drives the pipeline: tells the conductor the next step; the conductor decides only how to do it.
- Owns stage transitions; rejects illegal ones.
- A gate pass verifies its evidence before being accepted.
- Human decisions are accepted only with a hook-observed, human-typed `/factory` command; an LLM-asserted approval is rejected.
- Test, health, and scaffold claims are verified only by the CLI re-running the run-contract check; hook-observed test runs are supporting facts.
- Stop hook blocks the conductor from ending a turn while its run is working; stopping is allowed when every open step awaits the human or runs in the background, or the run is terminal; also when the turn holds a tool call the human rejected (from the session's own transcript). After `STOP_BLOCK_MAX` consecutive blocks with no tool call between them, the hook lets the stop through and records it.

## Identity and storage

- Session → run registry; events from unregistered sessions are dropped (plugin hooks fire for every session in the repo).
- Per-writer JSONL at `~/.factory/<repo-hash>/runs/` is the source of truth (no concurrent appends to one file).
- SQLite is a rebuildable cache; no required collector process.
- Liveness: heartbeat + `claude agents --json` (crashes emit no SessionEnd). Lost liveness shows on the dashboard only; it never pages the human.

## Dashboard

- Own build, minimal: tiny local process, JSONL → SQLite → SSE to browser; no Docker.
- Read-only window: all runs across worktrees as lanes — stage, current slice, reviewer verdicts, escalation queue.
- Human decisions (gates, escalations, cuts) are first-class, human-attributed events.
- Artifact view: the redacted text of each gate-pinned artifact, carried in event data — never read from disk by the dashboard.
- Borrows agents-observe patterns, not code.

## Replay

- WRAP snapshots and redacts transcripts (transcripts expire ~30 days and may hold secrets). Redaction scope includes gitignored files copied into factory worktrees (e.g. `.env`).
- Replay engine first targets single-run recordings; multi-run recordings exist only after parallel runs (`build-order.md`).
- Parallelism is demonstrated by replaying a real recorded multi-run session, never live.

## Optional

- OpenTelemetry for cost/token cross-check only — it cannot name custom subagents and has no worktree identity.

## Failure modes this design answers

Hooks not knowing the run id; hooks firing for all sessions; concurrent appends; sandbox blocking worktree→main writes; `git clean`/bare layouts destroying in-repo state; conductor lying or forgetting; crash without SessionEnd; transcript expiry and secrets.
